import logger from '../utils/logger';
import * as _ from 'lodash';
import { uploadMediaFile } from '../services/awsService';
import { updateProcess } from '../services/process';
import { contentStageMetaData, createContentStage, getAllStageContent, updateContentStage } from '../services/contentStage';
import { createContent, deleteContents, findExistingContentXIDs } from '../services/content';
import { checkValidity, convertToCSV, getCSVHeaderAndRow, getCSVTemplateHeader, preloadData, processRow, validateHeader } from '../services/util';
import { Status } from '../enums/status';
import { appConfiguration } from '../config';

const { requiredMetaFields } = appConfiguration;

let mediaFileEntries: any[];
let processId: string;

export const handleContentCsv = async (contentsCsv: object[], media: any, process_id: string) => {
  processId = process_id;
  mediaFileEntries = media;
  let contentsData: object[] = [];
  if (contentsCsv?.length === 0) {
    logger.error(`${processId} Content data validation returned empty data`);
    return {
      error: { errStatus: 'Empty', errMsg: 'empty content set data found' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }

  for (const contents of contentsCsv) {
    const validatedContentHeader = await validateCSVContentHeaderRow(contents);
    if (!validatedContentHeader?.result?.isValid) return validatedContentHeader;
    const {
      result: { data },
    } = validatedContentHeader;

    const validatedContentRows = processContentRows(data?.rows);
    if (!validatedContentRows?.result?.isValid) return validatedContentRows;
    const { result } = validatedContentRows;

    contentsData = contentsData.concat(result.data);
    if (contentsData?.length === 0) {
      logger.error('Error while processing the content csv data');
      return {
        error: { errStatus: 'Empty', errMsg: 'empty content set data found' },
        result: {
          isValid: false,
        },
      };
    }
  }

  logger.info('Insert content Stage::content Data ready for bulk insert');
  const createContents = await bulkInsertContentStage(contentsData);
  if (!createContents?.result?.isValid) return createContents;

  const validateContents = await validateStagedContentData();
  if (!validateContents?.result?.isValid) {
    logger.error('Content Validation::Error while validating stage content data');
    const uploadContent = await uploadErroredContentsToCloud();
    if (!uploadContent?.result?.isValid) return uploadContent;
    return validateContents;
  }

  await updateProcess(processId, { status: Status.VALIDATED });

  logger.info(`Content Media upload:: ${processId} content Stage data is ready for upload media to cloud`);
  const contentsMedia = await processContentMediaFiles();
  if (!contentsMedia?.result?.isValid) return contentsMedia;

  logger.info(`Content Main Insert::${processId} is Ready for inserting bulk upload to content`);
  const insertedMainContents = await insertMainContents();
  return insertedMainContents;
};

const validateCSVContentHeaderRow = async (contentEntry: any) => {
  const templateHeader = await getCSVTemplateHeader(contentEntry.entryName);
  if (!templateHeader?.result?.isValid) {
    return {
      error: { errStatus: 'Template missing', errMsg: 'template missing' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const contentRowHeader = getCSVHeaderAndRow(contentEntry);
  if (!contentRowHeader?.result?.isValid) {
    logger.error(`Content Row/Header::${contentEntry?.entryName} unexpected error while getting row and header`);
    return contentRowHeader;
  }

  const {
    result: {
      data: { header },
    },
  } = contentRowHeader;

  const isValidHeader = validateHeader(contentEntry.entryName, header, templateHeader.result.data);
  if (!isValidHeader?.result?.isValid) {
    logger.error(isValidHeader?.error?.errMsg);
    return isValidHeader;
  }

  logger.info(`content Row/Header:: Row and Header mapping process started for ${processId} `);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: contentRowHeader.result.data,
    },
  };
};

const processContentRows = (rows: any) => {
  const processData = processRow(rows);
  if (!processData || processData?.data?.length === 0) {
    logger.error(`Content Row/header:: ${processData.errMsg}`);
    return {
      error: { errStatus: 'process_error', errMsg: `content:: ${processData.errMsg}` },
      result: {
        isValid: false,
        data: processData.data,
      },
    };
  }
  logger.info('Insert content Stage:: Data ready for bulk insert to staging.');
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: processData.data,
    },
  };
};

const bulkInsertContentStage = async (insertData: object[]) => {
  const contentStage = await createContentStage(insertData);
  if (contentStage?.error) {
    logger.error(`Insert Content Staging:: ${processId} content bulk data error in inserting`);
    return {
      error: { errStatus: 'errored', errMsg: `content bulk data error in inserting ${contentStage.message}` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info(`Insert Content Staging:: ${processId} content bulk data inserted successfully to staging table `);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const validateStagedContentData = async () => {
  const getAllContentStage = await contentStageMetaData({ process_id: processId });
  let isValid = true;
  if (getAllContentStage?.error) {
    logger.error(`Validate Content Stage:: ${processId} ,the get all Data is invalid format or errored fields`);
    return {
      error: { errStatus: 'error', errMsg: 'unexceptional error occurred while get all stage data' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  if (_.isEmpty(getAllContentStage)) {
    logger.error(`Validate content Stage:: ${processId} ,staging Data is empty invalid format or errored fields`);
    return {
      error: { errStatus: 'error', errMsg: `content Stage data unexpected error .` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }

  // Check if any row has invalid fields and collect invalid field names
  const requiredMetaFieldsCheck = await checkRequiredMetaFields(getAllContentStage);
  if (!requiredMetaFieldsCheck?.result?.isValid) return requiredMetaFieldsCheck;

  const validateMetadata = await checkValidity(getAllContentStage);
  if (!validateMetadata?.result?.isValid) return validateMetadata;

  for (const content of getAllContentStage) {
    const { id, content_id, l1_skill } = content;
    const checkRecord = await contentStageMetaData({ content_id, l1_skill });
    if (checkRecord?.length > 1) {
      logger.error(`Duplicate content_id found for ${content_id} in the ${l1_skill}`);
      await updateContentStage(
        { id },
        {
          status: 'errored',
          error_info: `Duplicate content_id found for ${content_id} in the ${l1_skill}`,
        },
      );
      isValid = false;
    }
  }

  logger.info(`Validate Content Stage:: ${processId} , the staging Data content is valid`);
  return {
    error: { errStatus: isValid ? null : 'errored', errMsg: isValid ? null : 'Duplicate content_id found' },
    result: {
      isValid: isValid,
      data: null,
    },
  };
};

const uploadErroredContentsToCloud = async () => {
  const getContents = await getAllStageContent();
  if (getContents?.error) {
    logger.error('unexpected error occurred while get all stage data');
    return {
      error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while get all stage data' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  await updateProcess(processId, { content_error_file_name: 'content.csv', status: Status.ERROR });
  const uploadContent = await convertToCSV(getContents, 'contents');
  if (!uploadContent) {
    logger.error('Upload Cloud::Unexpected error occurred while upload to cloud');
    return {
      error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while upload to cloud' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info('Content csv upload:: all the data are validated successfully and uploaded to cloud for reference');
  return {
    error: { errStatus: 'validation_errored', errMsg: 'content file validation errored' },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const processContentMediaFiles = async () => {
  try {
    const getContents = await getAllStageContent();
    if (getContents?.error) {
      logger.error('unexpected error occurred while get all stage data');
      return {
        error: { errStatus: 'unexpected_error', errMsg: 'unexpected error occurred while get all stage data' },
        result: {
          isValid: false,
          data: null,
        },
      };
    }

    for (const content of getContents) {
      if (content?.media_files?.length > 0) {
        const mediaFiles = await Promise.all(
          content?.media_files?.map(async (o: string) => {
            const foundMedia = mediaFileEntries.slice(1).find((media: any) => {
              return media?.entryName.split('/')[1] === o;
            });
            if (foundMedia) {
              const mediaData = await uploadMediaFile(foundMedia, 'content');
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
            error: { errStatus: 'Empty', errMsg: 'No media found for the content' },
            result: {
              isValid: false,
              data: null,
            },
          };
        }
        const updateContent = await updateContentStage({ id: content.id }, { media_files: mediaFiles });
        if (updateContent?.error) {
          logger.error('Content Media upload:: Media validation or update failed');
        }
      }
    }

    logger.info('Content Media upload:: Media inserted and updated in the stage table');
    return {
      error: { errStatus: null, errMsg: null },

      result: {
        isValid: true,
        data: null,
      },
    };
  } catch (error: any) {
    logger.error(`An error occurred in processContentMediaFiles: ${error.message}`);
    return {
      error: { errStatus: null, errMsg: null },

      result: {
        isValid: false,
        data: null,
      },
    };
  }
};

const insertMainContents = async () => {
  const mainContents = await migrateToMainContent();
  if (!mainContents?.result?.isValid) return mainContents;

  logger.info(`Content Main insert:: bulk upload completed  for Process ID: ${processId}`);
  logger.info(`Completed:: ${processId} Content csv uploaded successfully`);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

export const migrateToMainContent = async () => {
  const getAllContentStage = await contentStageMetaData({ process_id: processId });
  if (getAllContentStage?.error) {
    logger.error(`Insert Content main:: ${processId} content bulk data error while get all stage data`);
    return {
      error: { errStatus: 'errored', errMsg: `Content bulk data error while get all stage data` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const insertData = await formatStagedContentData(getAllContentStage);
  if (insertData?.length === 0) {
    return {
      error: { errStatus: 'process_stage_data', errMsg: 'Error in formatting staging data to main table.' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const stageContentXIDs: string[] = insertData.map((datum) => datum.x_id);
  const existingXIDs = (await findExistingContentXIDs(stageContentXIDs)).map((datum: any) => datum.x_id);
  const commonXIDs = _.intersection(stageContentXIDs, existingXIDs);
  if (commonXIDs.length) {
    logger.error(`Insert Content main:: ${processId} content bulk data error in inserting to main table.`);
    return {
      error: { errStatus: 'errored', errMsg: `error while inserting staging data to content table :: Following content_id(s) already exist in the system: ${commonXIDs.join(', ')}` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const contentInsert = await createContent(insertData);
  if (contentInsert?.error) {
    logger.error(`Insert Content main:: ${processId} content bulk data error in inserting to main table`);
    return {
      error: { errStatus: 'errored', errMsg: 'content bulk data error in inserting to main table' },
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

const formatStagedContentData = async (stageData: any[]) => {
  const { boards, classes, skills, subSkills, repositories } = await preloadData();

  const transformedData = stageData.map((obj) => {
    return {
      identifier: obj.identifier,
      x_id: obj?.content_id,
      name: { en: obj?.title || obj?.question_text },
      description: { en: obj?.description },
      tenant: '',
      repository: repositories.find((repository: any) => repository?.name?.en === obj?.repository_name),
      taxonomy: {
        board: boards.find((board: any) => board?.name?.en === obj?.board),
        class: classes.find((Class: any) => Class?.name?.en === obj?.class),
        l1_skill: skills.find((skill: any) => skill.name.en == obj?.l1_skill),
        l2_skill: obj?.l2_skill.map((skill: string) => skills.find((Skill: any) => Skill?.name?.en === skill)),
        l3_skill: obj?.l3_skill.map((skill: string) => skills.find((Skill: any) => Skill?.name?.en === skill)),
      },
      sub_skills: obj?.sub_skills?.map((subSkill: string) => subSkills.find((sub: any) => sub?.name?.en === subSkill)),
      gradient: obj?.gradient,
      status: 'live',
      media: obj?.media_files,
      created_by: 'system',
      is_active: true,
    };
  });
  logger.info('Data transfer:: staging Data transferred as per original format');
  return transformedData;
};

export const destroyContent = async () => {
  const contents = await contentStageMetaData({ process_id: processId });
  const contentId = contents?.map((obj: any) => obj.identifier);
  const deletedContent = await deleteContents(contentId);
  return deletedContent;
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

      await updateContentStage(
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
