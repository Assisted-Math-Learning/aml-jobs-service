import logger from '../utils/logger';
import * as _ from 'lodash';
import { getAWSFolderMetaData } from '../services/awsService';
import { getProcessMetaData, updateProcess } from '../services/process';
import path from 'path';
import { appConfiguration } from '../config';
import { contentStageMetaData } from '../services/contentStage';
import { questionStageMetaData } from '../services/questionStage';
import { questionSetStageMetaData } from '../services/questionSetStage';
import { fetchAndExtractZipEntries } from '../services/util';
import { destroyQuestion, handleQuestionCsv, migrateToMainQuestion } from './question';
import { destroyQuestionSet, handleQuestionSetCsv, migrateToMainQuestionSet } from './questionSet';
import { destroyContent, handleContentCsv, migrateToMainContent } from './content';
import { Status } from '../enums/status';
import { ContentStage } from '../models/contentStage';
import { QuestionSetStage } from '../models/questionSetStage';
import { QuestionStage } from '../models/questionStage';
import { destroyAudio, destroyAudioMapping, handleAudioData } from './audio';
import { AudioStage } from '../models/audioStage';

const { csvFileName, fileUploadInterval, reCheckProcessInterval, bulkUploadFolder } = appConfiguration;
let fileName: string;
let processId: string;
let mediaEntries: any[];

export const bulkUploadProcess = async () => {
  await handleFailedProcess();
  const processesInfo = await getProcessMetaData({ status: 'open' });
  if (processesInfo.error) {
    logger.error('Error retrieving open processes.');
    return false;
  }
  const { getAllProcess } = processesInfo;
  try {
    for (const process of getAllProcess) {
      const { process_id, file_name, created_at } = process;
      logger.info(`Starting bulk upload job for process ID: ${process_id}.`);
      processId = process_id;
      const IsStaleProcess = await markStaleProcessesAsErrored(created_at);
      if (IsStaleProcess.result.isStale) {
        await updateProcess(processId, {
          error_status: 'errored',
          error_message: 'Is Stale process',
          status: Status.FAILED,
        });
        logger.error(`Process ID ${processId} is stale, skipping.`);
        continue;
      }
      fileName = file_name;
      const bulkUploadMetadata = await getAWSFolderMetaData(`${bulkUploadFolder}/${process_id}`);
      if (bulkUploadMetadata.error) {
        logger.error(`Error accessing cloud folder for process ID: ${process_id}.`);
        continue;
      }
      logger.info(`Validating bulk upload folder for process ID: ${process_id}.`);
      const zipValidation = await validateZipFile(bulkUploadMetadata.Contents, fileName);
      const {
        result: { isValidZip },
      } = zipValidation;
      if (!isValidZip) {
        const processUpdate = await updateProcess(processId, {
          error_status: zipValidation.error.errStatus,
          error_message: zipValidation.error.errMsg,
          status: Status.FAILED,
        });
        if (processUpdate.error) {
          logger.error(`Error updating process ID ${processId}, terminating job.`);
          return false;
        }
        continue;
      }
      const csvValidation = await validateCSVFilesFormatInZip();
      if (!csvValidation.result.isValid) {
        const processUpdate = await updateProcess(processId, {
          error_status: csvValidation.error.errStatus,
          error_message: csvValidation.error.errMsg,
          status: Status.FAILED,
        });
        if (processUpdate.error) {
          logger.error(`Error updating process ID ${processId}, terminating job.`);
          return false;
        }
        continue;
      }
      const handleCsv = await handleCSVFiles(csvValidation.result.data);
      if (!handleCsv.result.isValid) {
        const processUpdate = await updateProcess(processId, {
          error_status: handleCsv.error.errStatus,
          error_message: handleCsv.error.errMsg,
          status: Status.FAILED,
        });
        if (processUpdate.error) {
          logger.error(`Error updating process ID ${processId}, terminating job.`);
          return false;
        }
        continue;
      }
      await updateProcess(processId, { status: Status.COMPLETED });
      logger.info(`Process ID ${processId}: Bulk upload validation and insertion of questions, question sets, and content completed successfully.`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error during upload validation.Re upload file for new process';
    await updateProcess(processId, {
      status: Status.ERROR,
      error_status: 'errored',
      error_message: `Failed to retrieve metadata for process id: ${processId}. ${errorMsg}.Re upload file for new process`,
    });
    logger.error(errorMsg);
  }
};

const markStaleProcessesAsErrored = (created_at: Date): any => {
  const timeDifference = Math.floor((Date.now() - created_at.getTime()) / (1000 * 60 * 60));
  if (timeDifference > fileUploadInterval) {
    logger.error('Stale process:: The uploaded zip folder is empty, please ensure a valid upload file.');
    return {
      error: { errStatus: 'empty', errMsg: 'The uploaded zip folder is empty, please ensure a valid upload file.' },
      result: {
        isStale: true,
      },
    };
  }
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isStale: false,
    },
  };
};

const handleFailedProcess = async () => {
  const processesInfo = await getProcessMetaData({ status: Status.PROGRESS });
  const { getAllProcess } = processesInfo;
  for (const process of getAllProcess) {
    const { process_id, file_name, created_at } = process;
    fileName = file_name;
    processId = process_id;
    logger.info(`process reopened for ${process_id}`);
    const timeDifference = Math.floor((Date.now() - created_at.getTime()) / (1000 * 60 * 60));
    if (timeDifference >= reCheckProcessInterval) {
      await updateProcess(process_id, { status: Status.REOPEN });
      const isSuccessStageProcess = await checkStagingProcess();
      if (!isSuccessStageProcess) {
        await updateProcess(processId, { status: Status.ERROR, error_status: 'errored', error_message: 'The csv Data is invalid format or errored fields.Re upload file for new process' });
        logger.error(`Re-open process:: The csv Data is invalid format or errored fields for process id: ${process_id}`);
      } else {
        await updateProcess(processId, { status: Status.COMPLETED });
        logger.info(`Re-open process:: ${processId} Process completed successfully.`);
      }
    }
  }
};

const checkStagingProcess = async () => {
  const getAllQuestionStage = await questionStageMetaData({ process_id: processId });
  if (_.isEmpty(getAllQuestionStage)) {
    logger.info(`Re-open:: ${processId} ,the csv Data is invalid format or errored fields`);
    return { error: { errStatus: null, errMsg: null }, result: { validStageData: false, data: null } };
  } else {
    const getAllQuestionSetStage = await questionSetStageMetaData({ status: 'success', process_id: processId });
    if (_.isEmpty(getAllQuestionSetStage)) {
      logger.info(`Re-open:: ${processId} ,the csv Data is invalid format or errored fields`);
      return { error: { errStatus: null, errMsg: null }, result: { validStageData: false, data: null } };
    } else {
      const getAllContentStage = await contentStageMetaData({ status: 'success', process_id: processId });
      if (_.isEmpty(getAllContentStage)) {
        logger.info(`Re-open:: ${processId} ,the csv Data is invalid format or errored fields`);
        return { error: { errStatus: null, errMsg: null }, result: { validStageData: false, data: null } };
      }
    }
  }
  await migrateToMainQuestion();
  await migrateToMainQuestionSet();
  await migrateToMainContent();
  return { error: null, result: { validStageData: true, data: null } };
};

const validateZipFile = async (bulkUploadMetadata: any, fileName: string): Promise<any> => {
  if (_.isEmpty(bulkUploadMetadata)) {
    return {
      error: { errStatus: 'empty', errMsg: 'No zip file found' },
      result: { isValidZip: false, data: null },
    };
  }

  // Find the file metadata by matching the extracted fileName
  const fileMetadata = bulkUploadMetadata.find((file: any) => path.basename(file.Key) === fileName);

  const fileExt = fileMetadata ? path.extname(fileMetadata.Key).toLowerCase() : '';

  if (fileExt !== '.zip') {
    logger.error(`Zip Format::For ${processId} the ${fileMetadata.Key} Unsupported file format, please upload a ZIP file.`);
    return {
      error: { errStatus: 'unsupported_format', errMsg: 'The uploaded file is an unsupported format, please upload all CSV files inside a ZIP file.' },
      result: { isValidZip: false, data: null },
    };
  }
  await updateProcess(processId, { status: Status.PROGRESS, updated_by: 'system' });
  logger.info(`Zip Format:: ${processId} having valid zip file.`);
  return { error: { errStatus: null, errMsg: null }, result: { isValidZip: true, data: null } };
};

const validateCSVFilesFormatInZip = async () => {
  try {
    logger.info(`Zip extract:: ${processId} initiated to fetch and extract ZIP entries...`);
    const zipEntries = await fetchAndExtractZipEntries('upload', processId, fileName);

    if (!zipEntries.result.isValid) {
      return {
        error: { errStatus: 'invalid Zip', errMsg: `The uploaded  ZIP folder file format is invalid` },
        result: { isValid: false, data: [] },
      };
    }
    logger.info('Zip extract:: Filtering media entries from csv entries.');
    mediaEntries = zipEntries?.result?.data?.filter((zipEntry: any) => !zipEntry.entryName.endsWith('.csv'));
    logger.info('Zip extract:: Filtering csv entries from media entries.');
    const csvEntries = zipEntries?.result?.data?.filter((zipEntry: any) => zipEntry.entryName.endsWith('.csv'));

    for (const entry of csvEntries) {
      if (entry.isDirectory && entry.entryName.includes('.csv')) {
        logger.error(`File Format::For ${processId} The uploaded ${entry.entryName} ZIP folder file format is in valid`);
        return {
          error: { errStatus: 'unsupported_folder_type', errMsg: `The uploaded '${entry.entryName}' ZIP folder file format is invalid` },
          result: { isValid: false, data: [] },
        };
      }
      if (!csvFileName.includes(entry.entryName)) {
        logger.error(`File Format::For ${processId} The uploaded file '${entry.entryName}' is not a valid file name.`);
        return {
          error: { errStatus: 'unsupported_folder_type', errMsg: `The uploaded file '${entry.entryName}' is not a valid file name.` },
          result: { isValid: false, data: [] },
        };
      }
    }

    logger.info(`File Format:: ${processId} csv files are valid file name and format.`);
    return { error: { errStatus: null, errMsg: null }, result: { isValid: true, data: csvEntries } };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error during upload validation,please re upload the zip file for the new process';
    return { error: { errStatus: 'un-expected', errMsg: errorMsg }, result: { isValid: false, data: [] } };
  }
};

const handleCSVFiles = async (csvFiles: { entryName: string }[]) => {
  try {
    const validCSVData = {
      questions: [] as object[],
      questionSets: [] as object[],
      contents: [] as object[],
    };
    for (const csvFile of csvFiles) {
      const fileNameKey = csvFile?.entryName.split('-')[1];
      switch (fileNameKey) {
        case 'question.csv':
          validCSVData.questions.push(csvFile);
          break;

        case 'questionSet.csv':
          validCSVData.questionSets.push(csvFile);
          break;

        case 'content.csv':
          validCSVData.contents.push(csvFile);
          break;

        default:
          logger.error(`Unsupported sheet in file '${csvFile?.entryName}'.`);
          break;
      }
    }

    logger.info(`Content Validate::csv Data validation initiated for contents`);
    const contentsCsv = await handleContentCsv(validCSVData.contents, mediaEntries, processId);
    if (!contentsCsv?.result?.isValid) {
      logger.error(contentsCsv?.error?.errMsg);
      await ContentStage.destroy({ where: { process_id: processId } });
      await destroyContent();
      return contentsCsv;
    }

    logger.info(`Question Validate::csv Data validation initiated for question`);
    const { meta: questionsCsv, stageData: questionStageData } = await handleQuestionCsv(validCSVData.questions, mediaEntries, processId);
    if (!questionsCsv?.result?.isValid) {
      logger.error(questionsCsv?.error?.errMsg);
      await destroyContent();
      await ContentStage.destroy({ where: { process_id: processId } });
      await destroyQuestion();
      await QuestionStage.destroy({ where: { process_id: processId } });
      return questionsCsv;
    }

    logger.info(`Question Set Validate::csv Data validation initiated for questions Set`);
    const questionSetsCsv = await handleQuestionSetCsv(validCSVData.questionSets, processId);
    if (!questionSetsCsv?.result?.isValid) {
      logger.error(questionSetsCsv?.error?.errMsg);
      await destroyContent();
      await ContentStage.destroy({ where: { process_id: processId } });
      await destroyQuestion();
      await QuestionStage.destroy({ where: { process_id: processId } });
      await destroyQuestionSet();
      await QuestionSetStage.destroy({ where: { process_id: processId } });
      return questionSetsCsv;
    }

    logger.info(`Audio Validate::csv Data validation initiated for audio`);
    const audioCsv = await handleAudioData(questionStageData, processId);
    if (!audioCsv?.result?.isValid) {
      logger.error(audioCsv?.error?.errMsg);
      await destroyContent();
      await ContentStage.destroy({ where: { process_id: processId } });
      await destroyQuestion();
      await QuestionStage.destroy({ where: { process_id: processId } });
      await destroyQuestionSet();
      await QuestionSetStage.destroy({ where: { process_id: processId } });
      await destroyAudio();
      await destroyAudioMapping();
      await AudioStage.destroy({ where: { process_id: processId } });
      return audioCsv;
    } else {
      await ContentStage.truncate({ restartIdentity: true });
      await QuestionStage.truncate({ restartIdentity: true });
      await QuestionSetStage.truncate({ restartIdentity: true });
      await AudioStage.truncate({ restartIdentity: true });
    }

    return { error: { errStatus: null, errMsg: null }, result: { isValid: true, data: null } };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error during upload validation csv data,please re upload the zip file for the new process';
    return { error: { errStatus: 'errored', errMsg: errorMsg }, result: { isValid: false, data: null } };
  }
};
