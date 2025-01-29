import logger from '../utils/logger';
import * as _ from 'lodash';
import { uploadMediaFile } from '../services/awsService';
import { updateProcess } from '../services/process';
import { createQuestionStage, getAllStageQuestion, questionStageMetaData, updateQuestionStage } from '../services/questionStage';
import { appConfiguration } from '../config';
import { createQuestion, deleteQuestions, findExistingQuestionXIDs } from '../services/question';
import { checkValidity, convertToCSV, getCSVHeaderAndRow, getCSVTemplateHeader, preloadData, processRow, validateHeader } from '../services/util';
import { Status } from '../enums/status';
import { FibType } from '../enums/fibType';

let mediaFileEntries: any[];
let processId: string;

const { grid1AddFields, grid1DivFields, grid1MultipleFields, grid1SubFields, grid2Fields, mcqFields, fibFields, questionBodyFields, mediaFields, requiredMetaFields } = appConfiguration;

export const handleQuestionCsv = async (questionsCsv: object[], media: any, process_id: string) => {
  processId = process_id;
  mediaFileEntries = media;
  let questionsData: any[] = [];
  if (questionsCsv.length === 0) {
    logger.error(`${processId} Question data validation resulted in empty data.`);
    return {
      meta: {
        error: { errStatus: 'Empty', errMsg: 'empty question data found' },
        result: {
          isValid: false,
          data: null,
        },
      },
      stageData: [],
    };
  }

  for (const questions of questionsCsv) {
    const validQuestionHeader = await validateCSVQuestionHeaderRow(questions);
    if (!validQuestionHeader?.result?.isValid) return { meta: validQuestionHeader, stageData: [] };
    const {
      result: { data },
    } = validQuestionHeader;

    const validQuestionRows = processQuestionRows(data?.rows);
    if (!validQuestionRows?.result?.isValid) return { meta: validQuestionRows, stageData: [] };
    const { result } = validQuestionRows;

    questionsData = questionsData.concat(result.data);
    if (questionsData?.length === 0) {
      logger.error('Error while processing the question csv data');
      return {
        meta: {
          error: { errStatus: 'Empty', errMsg: 'empty question data found' },
          result: {
            isValid: false,
            data: null,
          },
        },
        stageData: [],
      };
    }
  }

  const descriptionFields = Object.keys(questionsData[0]).filter((field) => field.startsWith('description_'));
  const questionTextFields = Object.keys(questionsData[0]).filter((field) => field.startsWith('question_text_'));

  const questionsDataForStage = questionsData.map((data) => ({
    ...data,
    question_id: data.QID,
    question_text: questionTextFields.reduce((agg, curr) => {
      const languageKey = curr.split('_').pop() as string;
      _.set(agg, languageKey, data?.[curr]);
      return agg;
    }, {}),
    description: descriptionFields.reduce((agg, curr) => {
      const languageKey = curr.split('_').pop() as string;
      _.set(agg, languageKey, data?.[curr]);
      return agg;
    }, {}),
  }));

  logger.info('Insert question Stage::Questions Data ready for bulk insert');
  const createQuestions = await bulkInsertQuestionStage(questionsDataForStage);
  if (!createQuestions?.result?.isValid) return { meta: createQuestions, stageData: [] };

  const validateQuestions = await validateStagedQuestionData();
  if (!validateQuestions?.result?.isValid) {
    const uploadQuestion = await uploadErroredQuestionsToCloud();
    if (!uploadQuestion?.result?.isValid) return { meta: uploadQuestion, stageData: [] };
    return { meta: validateQuestions, stageData: [] };
  }

  await updateProcess(processId, { status: Status.VALIDATED });
  logger.info(`Question Media upload:: ${processId} question Stage data is ready for upload media `);

  const questionsMedia = await processQuestionMediaFiles();
  if (!questionsMedia?.result?.isValid) {
    logger.error('Error while validating stage question table');
    return { meta: questionsMedia, stageData: [] };
  }
  const insertedMainQuestions = await insertMainQuestions();
  return { meta: insertedMainQuestions, stageData: questionsDataForStage };
};

const validateCSVQuestionHeaderRow = async (questionEntry: any) => {
  const templateHeader = await getCSVTemplateHeader(questionEntry.entryName);
  if (!templateHeader?.result?.isValid) {
    return {
      error: { errStatus: 'Template missing', errMsg: 'template missing' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const questionRowHeader = getCSVHeaderAndRow(questionEntry);
  if (!questionRowHeader?.result?.isValid) {
    logger.error(`Question Row/header::Template header, header, or rows are missing  for file ${questionEntry.entryName}`);
    return questionRowHeader;
  }
  const {
    result: {
      data: { header },
    },
  } = questionRowHeader;
  const isValidHeader = validateHeader(questionEntry.entryName, header, templateHeader.result.data);
  if (!isValidHeader?.result?.isValid) {
    logger.error(isValidHeader?.error?.errMsg);
    return isValidHeader;
  }
  logger.info(`Question Row/header::Row and Header mapping process started for ${processId} `);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: questionRowHeader.result.data,
    },
  };
};

const processQuestionRows = (rows: any) => {
  const processData = processRow(rows);
  if (!processData || processData?.data?.length === 0) {
    logger.error(`Question Row/header:: ${processData.errMsg}`);
    return {
      error: { errStatus: 'process_error', errMsg: `question:: ${processData.errMsg}` },
      result: {
        isValid: false,
        data: processData.data,
      },
    };
  }
  logger.info('Question Row/header:: header and row process successfully and process 2 started');
  const updatedProcessData = processQuestionStage(processData.data);
  if (!updatedProcessData || updatedProcessData?.length === 0) {
    logger.error('Question Row/header:: Stage 2 data processing failed or returned empty data');
    return {
      error: { errStatus: 'process_stage_error', errMsg: 'Data processing failed or returned empty data' },
      result: {
        isValid: false,
        data: updatedProcessData,
      },
    };
  }
  logger.info('Insert question Stage::Questions Data ready for bulk insert');
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: updatedProcessData,
    },
  };
};

const bulkInsertQuestionStage = async (insertData: object[]) => {
  const questionStage = await createQuestionStage(insertData);
  if (questionStage?.error) {
    logger.error(`Insert Staging:: ${processId} question bulk data error in inserting`);
    return {
      error: { errStatus: 'errored', errMsg: `question bulk data error in inserting ${questionStage.message}` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info(`Insert Question Staging:: ${processId} question bulk data inserted successfully to staging table`);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const validateStagedQuestionData = async () => {
  const getAllQuestionStage = await questionStageMetaData({ process_id: processId });
  if (getAllQuestionStage?.error) {
    logger.error(`Validate Question Stage:: ${processId}.`);
    return {
      error: { errStatus: 'error', errMsg: `Validate Question Stage:: ${processId}.` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  let isUnique = true;
  let isValid = true;
  let errStatus = null,
    errMsg = null;
  if (_.isEmpty(getAllQuestionStage)) {
    logger.error(`Validate Question Stage:: ${processId} ,the question Data is empty,`);
    return {
      error: { errStatus: 'error', errMsg: `the question Data is empty` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }

  // Check if any row has invalid fields and collect invalid field names
  const requiredMetaFieldsCheck = await checkRequiredMetaFields(getAllQuestionStage);
  if (!requiredMetaFieldsCheck?.result?.isValid) return requiredMetaFieldsCheck;

  const validateMetadata = await checkValidity(getAllQuestionStage);
  if (!validateMetadata?.result?.isValid) return validateMetadata;

  for (const question of getAllQuestionStage) {
    const { id, question_id, question_set_id, question_type, l1_skill, body, sequence } = question;
    const checkRecord = await questionStageMetaData({ question_id, question_set_id, l1_skill, question_type, sequence });
    if (checkRecord?.error) {
      logger.error(`Validate Question Stage:: ${processId} ,${checkRecord.message}.`);
      return {
        error: { errStatus: 'error', errMsg: `unexpected error ,${checkRecord.message}` },
        result: {
          isValid: false,
        },
      };
    }
    if (checkRecord?.length > 1) {
      errMsg = `Duplicate question and question_set_id combination found for question id ${question_id} and question set id ${question_set_id} for ${question_type} ${l1_skill},with ${sequence}`;
      logger.error(errMsg);
      await updateQuestionStage(
        { id },
        {
          status: 'errored',
          error_info: errMsg,
        },
      );
      errStatus = 'errored';
      isUnique = false;
    }
    let requiredFields: string[] = [];
    let requiredData;
    const caseKey = question_type === 'Grid-1' ? `${question_type}_${l1_skill}` : question_type;
    switch (caseKey) {
      case `Grid-1_Addition`:
        requiredFields = grid1AddFields;
        break;
      case `Grid-1_Subtraction`:
        requiredFields = grid1SubFields;
        break;
      case `Grid-1_Multiplication`:
        requiredFields = grid1MultipleFields;
        break;
      case `Grid-1_Division`:
        requiredFields = grid1DivFields;
        break;
      case `Grid-2`:
        requiredFields = grid2Fields;
        break;
      case `Mcq`:
        requiredFields = mcqFields;
        requiredData = 'question_text,question_image,mcq_option_1,mcq_option_2,mcq_option_3,mcq_option_4,mcq_option_5,mcq_option_6,mcq_correct_options';
        break;
      case `Fib`:
        requiredFields = fibFields;
        break;
      default:
        requiredFields = [];
        break;
    }
    if (!requiredFields.map((field) => body[field] !== undefined && body[field] !== null)) {
      requiredData = 'grid_fib_n1,grid_fib_n2';
      await updateQuestionStage(
        { id },
        {
          status: 'errored',
          error_info: `Missing required data for type ${question_type},fields are ${requiredData}`,
        },
      );
      errStatus = 'errored';
      errMsg = `Missing required data for type ${question_type},fields are ${requiredData}`;
      isValid = false;
    }
  }
  logger.info(`Validate Question Stage::${processId} , everything in the Question stage Data valid.`);
  return {
    error: { errStatus: errStatus, errMsg: errMsg },
    result: {
      isValid: isUnique && isValid,
    },
  };
};

const uploadErroredQuestionsToCloud = async () => {
  const getQuestions = await getAllStageQuestion();
  if (getQuestions?.error) {
    logger.error('unexpected error occurred while get all stage data');
    return {
      error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while get all stage data' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  await updateProcess(processId, { question_error_file_name: 'questions.csv', status: Status.ERROR });
  const uploadQuestion = await convertToCSV(getQuestions, 'questions');
  if (!uploadQuestion) {
    logger.error('Upload Cloud::Unexpected error occurred while upload to cloud');
    return {
      error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while upload to cloud' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info('Question Upload Cloud::All the question are validated and uploaded in the cloud for reference');
  return {
    error: { errStatus: 'validation_errored', errMsg: 'question file validation errored' },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const processQuestionMediaFiles = async () => {
  try {
    const getQuestions = await getAllStageQuestion();
    if (getQuestions?.error) {
      logger.error('unexpected error occurred while get all stage data');
      return {
        error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while get all stage data' },
        result: {
          isValid: false,
          data: null,
        },
      };
    }
    for (const question of getQuestions) {
      if (question?.media_files?.length > 0) {
        const mediaFiles = await Promise.all(
          question?.media_files?.map(async (o: string) => {
            const foundMedia = mediaFileEntries.slice(1).find((media: any) => {
              return media?.entryName?.split('/')[1] === o;
            });
            if (foundMedia) {
              const mediaData = await uploadMediaFile(foundMedia, 'question');
              if (!mediaData) {
                logger.error(`Media upload failed for ${o}`);
                return null;
              }
              return mediaData;
            }
            return null;
          }),
        );

        if (mediaFiles?.length === 0) {
          return {
            error: { errStatus: 'Empty', errMsg: 'No media found for the question' },
            result: {
              isValid: false,
              data: null,
            },
          };
        }
        const updateContent = await updateQuestionStage({ id: question.id }, { media_files: mediaFiles });
        if (updateContent?.error) {
          logger.error('Question Media upload:: Media validation failed');
          return {
            error: { errStatus: 'failed', errMsg: 'error while uploading media in question' },
            result: {
              isValid: false,
              data: null,
            },
          };
        }
      }
      const {
        question_type,
        body: { question_image = null },
      } = question;
      if (['mcq', 'fib'].includes(question_type?.toLowerCase()) && question_image) {
        const foundImage = mediaFileEntries.slice(1).find((media: any) => {
          return media?.entryName?.split('/')[1] === question_image;
        });

        if (foundImage) {
          const imageData = await uploadMediaFile(foundImage, 'question');
          if (!imageData) {
            logger.error(`Image upload failed for ${question_image}`);
          }
          const body = { ...question.body, question_image: imageData };
          const updateContent = await updateQuestionStage({ id: question.id }, { body: body });
          if (updateContent?.error) {
            logger.error('Question Media upload:: Media validation failed');
            return {
              error: { errStatus: 'failed', errMsg: 'error while uploading image in question mcq' },
              result: {
                isValid: false,
                data: null,
              },
            };
          }
        }
      }
    }

    logger.info('Question Media upload::inserted and updated in the process data');
    return {
      error: { errStatus: null, errMsg: null },
      result: {
        isValid: true,
        data: null,
      },
    };
  } catch (error: any) {
    logger.error(`An error occurred in processQuestionMediaFiles: ${error.message}`);
    return {
      error: { errStatus: 'process_error', errMsg: error.message },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
};

const insertMainQuestions = async () => {
  const insertToMainQuestion = await migrateToMainQuestion();
  if (!insertToMainQuestion?.result?.isValid) return insertToMainQuestion;

  logger.info(`Question Bulk insert:: bulk upload completed  for Process ID: ${processId}`);
  logger.info(`Completed:: ${processId} Question csv uploaded successfully`);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

export const migrateToMainQuestion = async () => {
  const getAllQuestionStage = await questionStageMetaData({ process_id: processId });
  if (getAllQuestionStage?.error) {
    logger.error(`Validate Question Stage:: ${processId}.`);
    return {
      error: { errStatus: 'errored', errMsg: 'error while get all stage data' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const insertData = await formatQuestionStageData(getAllQuestionStage);
  if (insertData.length === 0) {
    return {
      error: { errStatus: 'process_stage_data', errMsg: 'Error in formatting staging data to main table.' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const stageQuestionsXIDs: string[] = insertData.map((datum) => datum.x_id);
  const existingXIDs = (await findExistingQuestionXIDs(stageQuestionsXIDs)).map((datum: any) => datum.x_id);
  const commonXIDs = _.intersection(stageQuestionsXIDs, existingXIDs);
  if (commonXIDs.length) {
    logger.error(`Insert Question main:: ${processId} question bulk data error in inserting to main table.`);
    return {
      error: { errStatus: 'errored', errMsg: `error while inserting staging data to question table :: Following QID(s) already exist in the system: ${commonXIDs.join(', ')}` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const questionInsert = await createQuestion(insertData);
  if (questionInsert?.error) {
    logger.error(`Insert Question main:: ${processId} question bulk data error in inserting to main table.`);
    return {
      error: { errStatus: 'errored', errMsg: 'error while inserting staging data to question table' },
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

const processQuestionStage = (questionsData: any) => {
  const fieldMapping: any = {
    'Grid-1_Addition': [...grid1AddFields, 'grid1_pre_fills_top', 'grid1_pre_fills_result'],
    'Grid-1_Subtraction': [...grid1SubFields, 'grid1_pre_fills_top', 'grid1_pre_fills_result'],
    'Grid-1_Multiplication': [...grid1MultipleFields, 'grid1_multiply_intermediate_steps_prefills', 'grid1_pre_fills_result'],
    'Grid-1_Division': [...grid1DivFields, 'grid1_pre_fills_remainder', 'grid1_pre_fills_quotient', 'grid1_div_intermediate_steps_prefills'],
    'Grid-2': [...grid2Fields, 'grid2_pre_fills_n1', 'grid2_pre_fills_n2'],
    Mcq: mcqFields,
    Fib: fibFields,
  };
  questionsData.forEach((question: any) => {
    const questionType = question?.question_type === 'Grid-1' ? `${question?.question_type}_${question?.l1_skill}` : question?.question_type;
    const relevantFields = fieldMapping[questionType];
    const filteredBody: any = {};
    relevantFields.forEach((field: any) => {
      if (question?.body[field] !== undefined) {
        filteredBody[field] = question?.body[field];
      }
    });
    question.body = filteredBody;
    mediaFields.forEach((prop: any) => delete question[prop]);
    questionBodyFields.forEach((prop: any) => delete question[prop]);
  });
  return questionsData;
};

const formatQuestionStageData = async (stageData: any[]) => {
  try {
    const { boards, classes, skills, subSkills, repositories } = await preloadData();

    const transformedData = stageData.map((obj) => {
      const {
        grid_fib_n1 = null,
        grid_fib_n2 = null,
        mcq_option_1 = null,
        mcq_option_2 = null,
        mcq_option_3 = null,
        mcq_option_4 = null,
        mcq_option_5 = null,
        mcq_option_6 = null,
        question_image = null,
        mcq_correct_options = null,
      } = obj?.body || {};
      return {
        identifier: obj.identifier,
        x_id: obj?.question_id,
        question_type: obj?.question_type,
        operation: obj?.l1_skill,
        hints: obj?.hint,
        name: obj?.question_text,
        description: obj?.description,
        tenant: '',
        repository: repositories.find((repository: any) => repository.name.en === obj?.repository_name),
        taxonomy: {
          board: boards.find((board: any) => board?.name?.en === obj?.board),
          class: classes.find((Class: any) => Class?.name?.en === obj?.class),
          l1_skill: skills.find((skill: any) => skill?.name?.en == obj?.l1_skill),
          l2_skill: obj?.l2_skill?.map((skill: string) => skills.find((Skill: any) => Skill?.name?.en === skill)),
          l3_skill: obj?.l3_skill?.map((skill: string) => skills.find((Skill: any) => Skill?.name?.en === skill)).filter((option: any) => !_.isEmpty(option)),
        },
        sub_skills: obj?.sub_skill?.map((subSkill: string) => subSkills.find((sub: any) => sub?.name?.en === subSkill)).filter((option: any) => !_.isEmpty(option)),
        question_body: {
          ...(obj?.body || {}),
          numbers: { n1: grid_fib_n1, n2: grid_fib_n2 },
          question_image: question_image,
          options:
            obj?.question_type?.toLowerCase() === 'mcq' ? [mcq_option_1, mcq_option_2, mcq_option_3, mcq_option_4, mcq_option_5, mcq_option_6].filter((option) => !_.isEmpty(option)) : undefined,
          correct_option: obj?.question_type?.toLowerCase() === 'mcq' ? mcq_correct_options : undefined,
          answers: getAnswer(obj?.l1_skill, obj?.question_type, obj?.body),
          wrong_answer: convertWrongAnswerSubSkills({ carry: obj?.sub_skill_carry, procedural: obj?.sub_skill_procedural, x_plus_x: obj?.sub_skill_x_plus_0, x_plus_0: obj?.sub_skill_x_plus_x }),
        },
        benchmark_time: obj?.benchmark_time,
        status: 'live',
        media: obj?.media_files,
        created_by: 'system',
        is_active: true,
      };
    });

    // transformedData = _.uniqBy(transformedData, 'x_id');

    logger.info('Data transfer:: staging Data transferred as per original format');
    return transformedData;
  } catch (error: any) {
    logger.error('Question Insert main::Error while formatting data for main ', error.message);
    throw error;
  }
};

const convertWrongAnswerSubSkills = (inputData: any) => {
  const wrongAnswers = [];

  for (const [key, value] of Object.entries(inputData)) {
    if (_.isEmpty(value)) {
      continue;
    }
    const numbers = (value as number[]).map(Number).filter((n: any) => !isNaN(n) && n !== '' && n !== undefined && n !== null);
    if (numbers.length > 0) {
      wrongAnswers.push({
        value: numbers,
        subskillname: key,
      });
    }
  }
  logger.info('Wrong answer:: wrong answer mapped to sub skills');
  return wrongAnswers;
};

const getAnswer = (skill: string, question_type: string, bodyObject: any) => {
  if (question_type === 'Fib') {
    const { fib_type, fib_answer, question_image } = bodyObject;
    if (!fib_type || !Object.values(FibType).includes(fib_type)) {
      throw new Error(`Invalid value for fib_type :: ${fib_type}`);
    }
    if ([FibType.FIB_STANDARD_WITH_IMAGE, FibType.FIB_QUOTIENT_REMAINDER_WITH_IMAGE].includes(fib_type) && !question_image) {
      throw new Error(`Missing value for question_image for fib_type :: ${fib_type}`);
    }
    if ([FibType.FIB_STANDARD_WITH_IMAGE, FibType.FIB_QUOTIENT_REMAINDER_WITH_IMAGE].includes(fib_type) && !fib_answer) {
      throw new Error(`Missing value for fib_answer for question_image :: ${question_image}`);
    }
  }

  switch (`${skill}_${question_type}`) {
    case 'Addition_Grid-1':
      return addGrid1Answer(bodyObject);
    case 'Addition_Fib':
      return addFIBAnswer(bodyObject);

    case 'Subtraction_Grid-1':
      return subGrid1Answer(bodyObject);
    case 'Subtraction_Fib':
      return subFIBAnswer(bodyObject);

    case 'Multiplication_Grid-1':
      return multiplicationGrid1Answer(bodyObject);
    case 'Multiplication_Fib':
      return multiplicationFIBAnswer(bodyObject);

    case 'Division_Grid-1':
      return divisionGrid1Answer(bodyObject);
    case 'Division_Fib':
      return divisionFIBAnswer(bodyObject);

    default:
      return undefined;
  }
};

const getCarryValues = (n1: string, n2: string) => {
  const maxLength = Math.max(n1.length, n2.length);
  const n1Str = n1.padStart(maxLength, '0');
  const n2Str = n2.padStart(maxLength, '0');

  let i = maxLength - 1;
  const carries = [];
  let lastCarry = 0;
  while (i > 0) {
    const num1 = +n1Str[i];
    const num2 = +n2Str[i];
    if (num1 + num2 + lastCarry > 9) {
      carries.unshift(1);
      lastCarry = 1;
    } else {
      lastCarry = 0;
      carries.unshift(0);
    }
    i--;
  }

  return carries;
};

const addGrid1Answer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, grid1_pre_fills_top, grid1_pre_fills_result, grid1_show_carry } = input;

  const n1 = parseInt(grid_fib_n1);
  const n2 = parseInt(grid_fib_n2);

  const result = n1 + n2;
  const resultStr = result.toString();
  let isPrefil = grid1_show_carry === 'yes';
  let errorMsg = '';
  let answerResult = '';

  const carries = getCarryValues(grid_fib_n1, grid_fib_n2);
  const validCarries = carries.filter((v) => !!v);

  if (validCarries.length !== grid1_pre_fills_top.length) {
    errorMsg = 'Incorrect grid1_pre_fills_top';
  }

  if (resultStr.length !== grid1_pre_fills_result.length) {
    errorMsg = 'Incorrect grid1_pre_fills_result';
  }

  if (errorMsg) {
    const errorContext = `grid_fib_n1 = ${grid_fib_n1} & grid_fib_n2 = ${grid_fib_n2}`;
    throw new Error(`${errorMsg} :: ${errorContext}`);
  }

  const answerTop: string[] = carries.map((val) => (val === 0 ? '#' : '1'));

  if (isPrefil) {
    isPrefil = !answerTop.every((item: string) => item === '#');
  }

  if (isPrefil) {
    const fillableIndicesOfAnswerTop = answerTop.reduce((agg: number[], curr, index) => {
      if (curr !== '#') {
        agg.push(index);
      }
      return agg;
    }, []);

    for (let i = 0; i < fillableIndicesOfAnswerTop.length; i++) {
      const indexOfAnswerTop = fillableIndicesOfAnswerTop[i];
      if (grid1_pre_fills_top[i] === 'B') {
        answerTop[indexOfAnswerTop] = 'B';
      }
    }
  }

  for (let i = resultStr.length - 1; i >= 0; i--) {
    if (grid1_pre_fills_result[i] === 'B') {
      answerResult += 'B';
    } else {
      answerResult += resultStr[i];
    }
  }

  return {
    result: parseInt(resultStr),
    isPrefil,
    answerTop: answerTop.join(''),
    answerResult: answerResult.split('').reverse().join(''),
  };
};

const addFIBAnswer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, fib_type, fib_answer } = input;

  if (fib_type === FibType.FIB_STANDARD_WITH_IMAGE) {
    return {
      result: fib_answer,
      fib_type,
    };
  }

  return {
    result: parseInt(grid_fib_n1) + parseInt(grid_fib_n2),
    fib_type,
  };
};

const addPaddingToDifference = (n1: number, n2: number) => {
  return !(n1.toString().length === 2 && n2.toString().length === 1 && (n1 - n2).toString().length === 1);
};

const borrowAndReturnNewNumber = (num: string, currentIndex: number) => {
  let numStr = num;
  const numOnLeft = +numStr[currentIndex - 1];
  if (numOnLeft > 0) {
    numStr = numStr.replaceAt(currentIndex - 1, `${numOnLeft - 1}`);
    return numStr;
  }

  return borrowAndReturnNewNumber(numStr.replaceAt(currentIndex - 1, '9'), currentIndex - 1);
};

const getSubGrid1AnswerTop = (n1: number, n2: number): string[] => {
  const originalN1Str = n1.toString();
  let n1Str = n1.toString();

  const L = n1Str.length;

  const n2Str = n2.toString().padStart(L, '0');

  const result = Array(L).fill('#');

  for (let i = L - 1; i >= 0; i--) {
    const num1 = +n1Str[i];
    const num2 = +n2Str[i];
    if (num1 < num2) {
      result[i] = num1 + 10;
      n1Str = borrowAndReturnNewNumber(n1Str, i);
      result[i] = `${num1 + 10}`;
      result[i - 1] = n1Str[i - 1];
    } else if (originalN1Str[i] !== n1Str[i]) {
      result[i] = n1Str[i];
    }
  }
  return result;
};

const subGrid1Answer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, grid1_pre_fills_top, grid1_pre_fills_result, grid1_show_regroup } = input;

  const maxLength = Math.max(grid_fib_n1.length, grid_fib_n2.length);
  const n1Str = grid_fib_n1.padStart(maxLength, '0');
  const n2Str = grid_fib_n2.padStart(n1Str.length, '0');
  let result = 0;
  let answerResult = '';
  let isPrefil = grid1_show_regroup === 'yes';
  const addPaddingToResult = addPaddingToDifference(grid_fib_n1, grid_fib_n2);
  let errorMsg = '';

  logger.info('[addSubAnswer] l1_skill is Subtraction');
  result = parseInt(n1Str) - parseInt(n2Str);

  const answerTop: string[] = getSubGrid1AnswerTop(n1Str, n2Str);
  if (isPrefil) {
    isPrefil = !answerTop.every((item: string) => item === '#');
  }

  if (isPrefil) {
    const fillableIndicesOfAnswerTop = answerTop.reduce((agg: number[], curr, index) => {
      if (curr !== '#') {
        agg.push(index);
      }
      return agg;
    }, []);

    if (fillableIndicesOfAnswerTop.length === grid1_pre_fills_top.length) {
      for (let i = 0; i < fillableIndicesOfAnswerTop.length; i++) {
        const indexOfAnswerTop = fillableIndicesOfAnswerTop[i];
        if (grid1_pre_fills_top[i] === 'B') {
          answerTop[indexOfAnswerTop] = 'B';
        }
      }
    } else {
      errorMsg = 'Incorrect grid1_pre_fills_top';
    }
  }

  let resultStr = result.toString();

  resultStr = addPaddingToResult ? resultStr.padStart(n1Str.length, '0') : resultStr;

  if (resultStr.length !== grid1_pre_fills_result.length) {
    errorMsg = 'Incorrect grid1_pre_fills_result';
  }

  if (errorMsg) {
    const errorContext = `grid_fib_n1 = ${grid_fib_n1} & grid_fib_n2 = ${grid_fib_n2}`;
    throw new Error(`${errorMsg} :: ${errorContext}`);
  }

  for (let i = resultStr.length - 1; i >= 0; i--) {
    if (grid1_pre_fills_result[i] === 'B') {
      answerResult += 'B';
    } else {
      answerResult += resultStr[i];
    }
  }

  return {
    result: resultStr,
    isPrefil,
    answerTop: answerTop.join('|'),
    answerResult: answerResult.split('').reverse().join(''),
  };
};

const subFIBAnswer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, fib_type, fib_answer } = input;

  if (fib_type === FibType.FIB_STANDARD_WITH_IMAGE) {
    return {
      result: fib_answer,
      fib_type,
    };
  }

  return {
    result: parseInt(grid_fib_n1) - parseInt(grid_fib_n2),
    fib_type,
  };
};

const multiplicationGrid1Answer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, grid1_multiply_intermediate_steps_prefills, grid1_pre_fills_result } = input;

  const isIntermediatePrefill = grid_fib_n2.toString().length > 1;
  const intermediateStepPrefills: string[] = grid1_multiply_intermediate_steps_prefills?.split('#');

  let errorMsg = '';
  const answers: string[] = [];
  const actualResult = grid_fib_n1 * grid_fib_n2;

  if (isIntermediatePrefill) {
    let factor = 1;
    let num2Copy = grid_fib_n2;

    while (num2Copy > 0) {
      const lastDigit = num2Copy % 10;
      const product = lastDigit * grid_fib_n1 * factor;
      const answer = product === 0 ? product.toString().padStart(grid_fib_n1.toString().length + Math.log10(factor), '0') : product.toString();
      answers.unshift(answer);
      factor *= 10;
      num2Copy = Math.floor(num2Copy / 10);
    }

    // Validate lengths
    if (answers.length !== intermediateStepPrefills.length) {
      errorMsg = 'Incorrect grid1_multiply_intermediate_steps_prefills';
    }

    for (let i = 0; i < intermediateStepPrefills.length; i++) {
      if (answers[i].length !== intermediateStepPrefills[i].length) {
        errorMsg = 'Incorrect grid1_multiply_intermediate_steps_prefills';
      }
    }
  }

  if (actualResult.toString().length !== grid1_pre_fills_result.length) {
    errorMsg = 'Incorrect grid1_pre_fills_result';
  }

  if (errorMsg) {
    const errorContext = `grid_fib_n1 = ${grid_fib_n1} & grid_fib_n2 = ${grid_fib_n2}`;
    throw new Error(`${errorMsg} :: ${errorContext}`);
  }

  const answerIntermediateRaw = answers.join('#');
  const answerIntermediate = grid1_multiply_intermediate_steps_prefills.split('');

  for (let i = 0; i < answerIntermediate.length; i++) {
    if (answerIntermediate[i] === 'F') {
      answerIntermediate[i] = answerIntermediateRaw[i];
    }
  }

  const answerResultString = grid1_pre_fills_result
    .split('')
    .map((char: string, index: number) => (char === 'F' ? actualResult.toString()[index] : char))
    .join('');

  return {
    isIntermediatePrefill,
    answerIntermediate: answerIntermediate.join('').split('#').reverse().join('#'),
    result: actualResult,
    answerResult: answerResultString,
  };
};

const multiplicationFIBAnswer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, fib_type, fib_answer } = input;

  if (fib_type === FibType.FIB_STANDARD_WITH_IMAGE) {
    return {
      result: fib_answer,
      fib_type,
    };
  }

  return {
    result: parseInt(grid_fib_n1) * parseInt(grid_fib_n2),
    fib_type,
  };
};

const getDivGrid1IntermediateStepsQuotientAndRemainder = (n1: number, n2: number) => {
  const n1Str = n1.toString();
  const answers: string[] = [];
  const answersWithPadding: string[] = [];
  let currentNumber = 0;
  let k = 0;
  let lastDifferenceValue = '';
  let lastSubN1 = 0;
  let lastSubN2 = 0;
  for (let i = 0; i < n1Str.length && k < n1Str.length; i++) {
    if (lastDifferenceValue !== '' && +lastDifferenceValue === 0 && +n1Str[k] < n2) {
      answers.push(lastDifferenceValue + n1Str[k]);
      answersWithPadding.push(answers[answers.length - 1].toString().padStart(k + 1, '#'));
      answers.push('0');
      answersWithPadding.push(answers[answers.length - 1].toString().padStart(k + 1, '#'));
      lastSubN1 = Number(lastDifferenceValue + n1Str[k]);
      lastSubN2 = 0;
      lastDifferenceValue = n1Str[k];
      currentNumber = +lastDifferenceValue;
      k++;
      continue;
    }
    let skipSlice = false;
    if (lastDifferenceValue !== '' && +lastDifferenceValue === 0) {
      skipSlice = true;
    }
    if (i === 0) {
      while (currentNumber < n2 && k < n1Str.length) {
        currentNumber = currentNumber * 10 + +n1Str[k++];
      }
    } else if (k < n1Str.length) {
      if (currentNumber < n2) {
        currentNumber = currentNumber * 10 + +n1Str[k];
      }
      if (currentNumber < n2) {
        answers.push(lastDifferenceValue + n1Str[k]);
        answersWithPadding.push(answers[answers.length - 1].toString().padStart(k + 1, '#'));
        answers.push('0');
        answersWithPadding.push(answers[answers.length - 1].toString().padStart(k + 1, '#'));
        lastSubN1 = Number(lastDifferenceValue + n1Str[k]);
        lastSubN2 = 0;
        lastDifferenceValue = Number(lastDifferenceValue + n1Str[k]).toString();
        currentNumber = +lastDifferenceValue;
        k++;
        continue;
      } else {
        k++;
      }
    }
    if (i > 0) {
      const finalCurrentNumber = lastDifferenceValue + currentNumber.toString().slice(skipSlice ? 0 : Number(lastDifferenceValue).toString().length);
      answers.push(finalCurrentNumber);
      answersWithPadding.push(answers[answers.length - 1].toString().padStart(k, '#'));
    }
    const closestMultiple = Math.floor(currentNumber / n2) * n2;
    answers.push(closestMultiple.toString());
    answersWithPadding.push(answers[answers.length - 1].toString().padStart(k, '#'));
    const difference = (currentNumber - closestMultiple).toString();
    lastDifferenceValue = addPaddingToDifference(currentNumber, closestMultiple) ? difference.padStart(currentNumber.toString().length, '0') : difference;
    lastSubN1 = currentNumber;
    lastSubN2 = closestMultiple;
    currentNumber = +difference;
  }

  const remainder = (lastSubN1 - lastSubN2).toString();

  return {
    intermediateSteps: answers,
    intermediateStepsWithPadding: answersWithPadding,
    quotient: Math.floor(n1 / n2).toString(),
    remainder: addPaddingToDifference(lastSubN1, lastSubN2) ? remainder.padStart(lastSubN1.toString().length, '0') : remainder,
  };
};

const getPaddedInterMediateStepsPattern = (intermediateSteps: string[], intermediateStepsWithPadding: string[]) => {
  const finalAns: string[] = [];

  for (let i = 0; i < intermediateSteps.length; i++) {
    finalAns.push(intermediateSteps[i].padStart(intermediateStepsWithPadding[i].length, '#'));
  }

  return finalAns.join('|');
};

const divisionGrid1Answer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, grid1_pre_fills_quotient, grid1_pre_fills_remainder, grid1_div_intermediate_steps_prefills } = input;
  let errorMsg = '';

  const { intermediateSteps, intermediateStepsWithPadding, quotient, remainder } = getDivGrid1IntermediateStepsQuotientAndRemainder(grid_fib_n1, grid_fib_n2);

  // Validate Intermediate Prefills
  const intermediatePrefills = (grid1_div_intermediate_steps_prefills || '').split('#').reverse();

  if (
    intermediateSteps.length !== intermediatePrefills.length ||
    !Array(intermediateSteps.length)
      .fill(0)
      .every((_, index) => intermediateSteps[index].length === intermediatePrefills[index].length)
  ) {
    errorMsg = 'Incorrect grid1_div_intermediate_steps_prefills';
  }

  // Validate Quotient Prefills
  if (!errorMsg && quotient.length !== grid1_pre_fills_quotient.length) {
    errorMsg = 'Incorrect grid1_pre_fills_quotient';
  }

  // Validate Remainder Prefills
  if (!errorMsg && remainder.length !== grid1_pre_fills_remainder.length) {
    errorMsg = 'Incorrect grid1_pre_fills_remainder';
  }

  if (errorMsg) {
    const errorContext = `grid_fib_n1 = ${grid_fib_n1} & grid_fib_n2 = ${grid_fib_n2}`;
    throw new Error(`${errorMsg} :: ${errorContext}`);
  }

  const intermediatePrefillsReverse = ((grid1_div_intermediate_steps_prefills as string) || '').split('#').reverse().join('|');
  let intermediateStepsPattern = intermediateSteps.join('|');

  for (let i = 0; i < intermediateStepsPattern.length; i++) {
    if (intermediatePrefillsReverse[i] === 'B') {
      intermediateStepsPattern = intermediateStepsPattern.replaceAt(i, 'B');
    }
  }

  let answerQuotient = quotient;
  for (let i = 0; i < grid1_pre_fills_quotient.length; i++) {
    if (grid1_pre_fills_quotient[i] === 'B') {
      answerQuotient = answerQuotient.replaceAt(i, 'B');
    }
  }

  let answerRemainder = remainder;
  for (let i = 0; i < grid1_pre_fills_remainder.length; i++) {
    if (grid1_pre_fills_remainder[i] === 'B') {
      answerRemainder = answerRemainder.replaceAt(i, 'B');
    }
  }

  return {
    answerIntermediate: getPaddedInterMediateStepsPattern(intermediateStepsPattern.split('|'), intermediateStepsWithPadding), // padding the steps with '#' for proper alignment from LHS
    answerQuotient,
    answerRemainder: answerRemainder.padStart(grid_fib_n1.toString().length, '#'), // padding the answer with '#' for proper alignment from LHS
    result: {
      quotient,
      remainder,
    },
  };
};

const divisionFIBAnswer = (input: any) => {
  const { grid_fib_n1, grid_fib_n2, fib_type, fib_answer } = input;

  if ([FibType.FIB_STANDARD_WITH_IMAGE, FibType.FIB_QUOTIENT_REMAINDER_WITH_IMAGE].includes(fib_type)) {
    return {
      result: fib_answer,
      fib_type,
    };
  }

  let result: any = Math.floor(parseInt(grid_fib_n1) / parseInt(grid_fib_n2));

  if (fib_type === FibType.FIB_QUOTIENT_REMAINDER) {
    result = {
      quotient: Math.floor(parseInt(grid_fib_n1) / parseInt(grid_fib_n2)),
      remainder: parseInt(grid_fib_n1) % parseInt(grid_fib_n2),
    };
  }

  return {
    result,
    fib_type,
  };
};

export const destroyQuestion = async () => {
  const questions = await questionStageMetaData({ process_id: processId });
  const questionId = questions.map((obj: any) => obj.identifier);
  const deletedQuestion = await deleteQuestions(questionId);
  return deletedQuestion;
};

const checkRequiredMetaFields = async (stageData: any) => {
  const allInvalidFields: string[] = [];

  for (const row of stageData) {
    const invalidFieldsInRow: string[] = [];

    _.forEach(requiredMetaFields, (field) => {
      const value = row[field];
      if (_.isNull(value)) {
        invalidFieldsInRow.push(field);
      }
    });

    if (!_.isEmpty(invalidFieldsInRow)) {
      allInvalidFields.push(...invalidFieldsInRow);

      await updateQuestionStage(
        { id: row.id },
        {
          status: 'errored',
          error_info: `Empty field identified ${invalidFieldsInRow.join(',')}`,
        },
      );
    }
  }

  const uniqueInvalidFields = _.uniq(allInvalidFields);
  if (uniqueInvalidFields.length > 0) {
    return {
      error: { errStatus: 'error', errMsg: `Skipping the process due to invalid field(s): ${uniqueInvalidFields.join(',')}` },
      result: {
        isValid: false,
      },
    };
  }

  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
    },
  };
};
