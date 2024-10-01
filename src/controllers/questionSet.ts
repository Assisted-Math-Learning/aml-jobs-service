import logger from '../utils/logger';
import * as _ from 'lodash';
import * as uuid from 'uuid';
import { updateProcess } from '../services/process';
import { createQuestionSetStage, getAllStageQuestionSet, questionSetStageMetaData, updateQuestionStageSet } from '../services/questionSetStage';
import { QuestionSetStage } from '../models/questionSetStage';
import { createQuestionSet } from '../services/questionSet';
import { getCSVTemplateHeader, getCSVHeaderAndRow, validateHeader, processRow, convertToCSV, preloadData, checkValidity } from '../services/util';
import { Status } from '../enums/status';
import { getContents } from '../services/content';

let processId: string;

export const handleQuestionSetCsv = async (questionSetsCsv: object[], process_id: string) => {
  processId = process_id;
  let questionSetsData: object[] = [];
  if (questionSetsCsv.length === 0) {
    logger.error(`${processId} Question set data validation resulted in empty data.`);
    return {
      error: { errStatus: 'Empty', errMsg: 'empty question set data found' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }

  for (const questionSet of questionSetsCsv) {
    const validatedQuestionSetHeader = await validateCSVQuestionSetHeaderRow(questionSet);
    if (!validatedQuestionSetHeader.result.isValid) return validatedQuestionSetHeader;

    const {
      result: { data },
    } = validatedQuestionSetHeader;

    const validatedRowData = processQuestionSetRows(data?.rows, data?.header);
    if (!validatedRowData.result.isValid) return validatedRowData;
    const { result } = validatedRowData;

    questionSetsData = questionSetsData.concat(result.data);
    if (questionSetsData.length === 0) {
      logger.error('Error while processing the question set csv data');
      return {
        error: { errStatus: 'Empty', errMsg: 'Error question set csv data' },
        result: {
          isValid: false,
          data: null,
        },
      };
    }
  }

  logger.info('Insert question Set Stage::Questions set Data ready for bulk insert');
  const createQuestionSetsStage = await bulkInsertQuestionSetStage(questionSetsData);
  if (!createQuestionSetsStage.result.isValid) return createQuestionSetsStage;

  const validateQuestionSets = await validateQuestionSetsStage();
  if (!validateQuestionSets.result.isValid) {
    logger.error('Error while validating stage question set data');
    const uploadQuestionSets = await uploadErroredQuestionSetsToCloud();
    if (!uploadQuestionSets.result.isValid) return uploadQuestionSets;
    return validateQuestionSets;
  }

  await updateProcess(processId, { status: Status.VALIDATED });

  const insertedQuestionSets = await insertMainQuestionSets();
  return insertedQuestionSets;
};

const validateCSVQuestionSetHeaderRow = async (questionSetEntry: any) => {
  const templateHeader = await getCSVTemplateHeader(questionSetEntry.entryName);
  if (!templateHeader.result.isValid) {
    return {
      error: { errStatus: 'Template missing', errMsg: 'template missing' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const questionSetRowHeader = getCSVHeaderAndRow(questionSetEntry);
  if (!questionSetRowHeader.result.isValid) {
    logger.error(`Question Set Row/header:: Template header, header, or rows are missing for  ${questionSetEntry.entryName}`);
    return questionSetRowHeader;
  }

  const {
    result: {
      data: { header },
    },
  } = questionSetRowHeader;
  const isValidHeader = validateHeader(questionSetEntry.entryName, header, templateHeader.result.data);
  if (!isValidHeader.result.isValid) {
    logger.error('Question Set Row/header:: Header validation failed');
    return isValidHeader;
  }

  logger.info(`Question Set Row/header:: Row and Header mapping process started for ${processId} `);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: questionSetRowHeader.result.data,
    },
  };
};

const processQuestionSetRows = (rows: any, header: any) => {
  const processedRowData = processRow(rows, header);
  if (!processedRowData || processedRowData.length === 0) {
    logger.error('Question Set Row/header:: Row processing failed or returned empty data');
    return {
      error: { errStatus: 'process_error', errMsg: 'Row processing failed or returned empty data' },
      result: {
        isValid: false,
        data: processedRowData,
      },
    };
  }
  logger.info('Insert Question Set Stage::Question sets  Data ready for bulk insert');
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: processedRowData,
    },
  };
};

const bulkInsertQuestionSetStage = async (insertData: object[]) => {
  const questionSetStage = await createQuestionSetStage(insertData);
  if (questionSetStage.error) {
    logger.error(`Insert Question SetStaging:: ${processId} question set  bulk data error in inserting ,${questionSetStage.message}`);
    return {
      error: { errStatus: 'errored', errMsg: `question set bulk data error in inserting,${questionSetStage.message}` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info(`Insert Question Set Staging:: ${processId} question set bulk data inserted successfully to staging table `);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const validateQuestionSetsStage = async () => {
  const getAllQuestionSetStage = await questionSetStageMetaData({ process_id: processId });
  const validateMetadata = await checkValidity(getAllQuestionSetStage);
  if (!validateMetadata.result.isValid) return validateMetadata;
  if (getAllQuestionSetStage.error) {
    logger.error(`Validate Question Set Stage:: ${processId} unexpected error.`);
    return {
      error: { errStatus: 'error', errMsg: `question Set Stage data  unexpected error.` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  if (_.isEmpty(getAllQuestionSetStage)) {
    logger.info(`Validate Question set Stage:: ${processId} ,staging Data is empty invalid format or errored fields`);
    return {
      error: { errStatus: 'error', errMsg: `question Set Stage data unexpected error .` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  let isValid = true;
  for (const questionSet of getAllQuestionSetStage) {
    const { id, question_set_id, l1_skill } = questionSet;
    const checkRecord = await questionSetStageMetaData({ question_set_id, l1_skill });
    if (checkRecord.error) {
      logger.error(`Validate Question Set Stage:: ${processId}.`);
      return {
        error: { errStatus: 'error', errMsg: `question Set Stage data unexpected error.` },
        result: {
          isValid: false,
          data: null,
        },
      };
    }
    if (checkRecord.length > 1) {
      await updateQuestionStageSet(
        { id },
        {
          status: 'errored',
          error_info: `Duplicate question_set_id found as ${question_set_id} for ${l1_skill}`,
        },
      );

      isValid = false;
    }
  }
  logger.info(`Validate Question set Stage:: ${processId} , the staging Data question set is valid`);
  return {
    error: { errStatus: isValid ? null : 'errored', errMsg: isValid ? null : 'Duplicate question_set_id found.' },
    result: {
      isValid: isValid,
      data: null,
    },
  };
};

const uploadErroredQuestionSetsToCloud = async () => {
  const questionSets = await getAllStageQuestionSet();
  if (questionSets.error) {
    logger.error('unexpected error occurred while get all stage data');
    return {
      error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while get all stage data' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  await updateProcess(processId, { question_set_error_file_name: 'questionSet.csv', status: Status.ERROR });
  const uploadQuestionSet = await convertToCSV(questionSets, 'questionSets');
  if (!uploadQuestionSet) {
    logger.error('Upload Cloud::Unexpected error occurred while upload to cloud');
    return {
      error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while upload to cloud' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info('Question set:: all the data are validated successfully and uploaded to cloud for reference');
  return {
    error: { errStatus: 'validation_errored', errMsg: 'question set file validation errored' },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const insertMainQuestionSets = async () => {
  const insertedMainQuestionSets = await migrateToMainQuestionSet();
  if (!insertedMainQuestionSets.result.isValid) {
    logger.error(`Question set bulk insert:: ${processId} staging data are invalid for main question set insert`);
    return insertedMainQuestionSets;
  }

  await QuestionSetStage.truncate({ restartIdentity: true });
  logger.info(`Question set bulk upload:: completed successfully and question_sets.csv file upload to cloud for Process ID: ${processId}`);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

export const migrateToMainQuestionSet = async () => {
  const getAllQuestionSetStage = await questionSetStageMetaData({ process_id: processId });
  if (getAllQuestionSetStage.error) {
    logger.error(`Insert Question set main:: ${processId}.`);
    return {
      error: { errStatus: 'errored', errMsg: 'error in question set insert to main table ' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const insertData = await formatStagedQuestionSetData(getAllQuestionSetStage);
  if (insertData.length === 0) {
    return {
      error: { errStatus: 'process_stage_data', errMsg: 'Error in formatting staging data question set to main table.' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const insertedQuestionSets = await createQuestionSet(insertData);
  if (insertedQuestionSets.error) {
    logger.error(`Insert Question set main:: ${processId} question set data error in inserting to main table .`);
    return {
      error: { errStatus: 'errored', errMsg: `question set bulk data error in inserting .` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }

  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const formatStagedQuestionSetData = async (stageData: any[]) => {
  const { boards, classes, skills, subSkills, repositories } = await preloadData();
  const contentData = await getContents();
  const transformedData = stageData.map((obj) => {
    const contentId = obj.instruction_media?.map((qs_Content: string) => contentData.find((content: any) => content.content_id === qs_Content));
    const SubSkills = obj.sub_skills.map((subSkill: string) => subSkills.find((sub: any) => sub.name.en === subSkill)).filter((sub: any) => sub);
    const transferData = {
      identifier: uuid.v4(),
      question_set_id: obj.question_set_id,
      content_id: contentId?.identifier ?? null,
      instruction_text: obj.instruction_text ?? '',
      sequence: obj.sequence,
      title: { en: obj.title || obj.question_text },
      description: { en: obj.description },
      tenant: '',
      repository: repositories.find((repository: any) => repository.name.en === obj.repository_name),
      taxonomy: {
        board: boards.find((board: any) => board.name.en === obj.board),
        class: classes.find((Class: any) => Class.name.en === obj.class),
        l1_skill: skills.find((skill: any) => skill.name.en == obj.l1_skill),
        l2_skill: obj.l2_skill.map((skill: string) => skills.find((Skill: any) => Skill.name.en === skill)),
        l3_skill: obj.l3_skill.map((skill: string) => skills.find((Skill: any) => Skill.name.en === skill)),
      },
      sub_skills: SubSkills ?? null,
      purpose: obj.purpose,
      is_atomic: obj.is_atomic,
      gradient: obj.gradient,
      group_name: obj.group_name,
      status: 'draft',
      process_id: obj.process_id,
      created_by: 'system',
      is_active: true,
    };
    return transferData;
  });
  logger.info('Data transfer:: staging Data transferred as per original format');
  return transformedData;
};
