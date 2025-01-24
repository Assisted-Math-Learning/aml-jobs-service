import { createHash } from 'crypto';
import { Status } from '../enums/status';
import { createAudio, createAudioMapping, deleteAudioMappings, deleteAudios, getAllAudioForHashes } from '../services/audio';
import { audioStageMetaData, createAudioStage } from '../services/audioStage';
import { updateProcess } from '../services/process';
import { findExistingQuestionWithXIDs, updateQuestion } from '../services/question';
import logger from '../utils/logger';
import { ttsService } from '../services/integrations/ttsService';
import { uploadBufferToS3 } from '../services/awsService';
import * as uuid from 'uuid';
import { chunk, uniqBy } from 'lodash';
import { supportedLanguages_TTS } from '../enums/ttsEnum';
import { AppDataSource } from '../config';

let processId: string;

export const destroyAudio = async () => {
  const audios = await audioStageMetaData({ process_id: processId });
  const audioIds = audios.map((obj: any) => obj.identifier);
  return deleteAudios(audioIds);
};

export const destroyAudioMapping = async () => {
  const audios = await audioStageMetaData({ process_id: processId });
  const question_ids = audios.map((obj: any) => obj.question_id);
  return deleteAudioMappings(question_ids);
};

export const handleAudioData = async (questionStageData: any[], process_id: string) => {
  processId = process_id;

  const questionsDataForAudioStageStage = questionStageData.map((data) => ({
    question_id: data.question_id,
    audio_description: {
      ...Object.keys(supportedLanguages_TTS).reduce((acc: any, key: any) => {
        acc[key] = data?.[`audio_description_${key}`] || '';
        return acc;
      }, {}),
      en: data?.audio_description_en || data?.audio_description || '',
    },
  }));

  const audioStagingData = questionsDataForAudioStageStage
    .map((data) =>
      Object.entries(data.audio_description).map((description) => ({
        process_id: process_id,
        created_by: 'system',
        question_id: data.question_id,
        language: description[0],
        audio_description: description[1],
      })),
    )
    .flat()
    .filter((data) => data.audio_description);

  if (audioStagingData.length === 0)
    return {
      error: { errStatus: null, errMsg: null },
      result: {
        isValid: true,
        data: null,
      },
    };

  logger.info('Insert Audio Stage::Audio Data ready for bulk insert');
  const createAudio = await bulkInsertAudioStage(audioStagingData);
  if (!createAudio?.result?.isValid) return createAudio;

  await updateProcess(processId, { status: Status.VALIDATED });
  logger.info(`Audio Staging:: ${processId} audio bulk data inserted successfully to staging table`);

  const insertedMainAudios = await insertMainAudios();
  return insertedMainAudios;
};

const bulkInsertAudioStage = async (insertData: object[]) => {
  const audioStage = await createAudioStage(insertData);
  if (audioStage?.error) {
    logger.error(`Insert Staging:: ${processId} audio bulk data error in inserting`);
    return {
      error: { errStatus: 'errored', errMsg: `audio bulk data error in inserting ${audioStage.message}` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info(`Insert Audio Staging:: ${processId} audio bulk data inserted successfully to staging table`);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

const insertMainAudios = async () => {
  const insertToMainQuestion = await migrateToMainAudio();
  if (!insertToMainQuestion?.result?.isValid) return insertToMainQuestion;

  logger.info(`Audios Bulk insert:: bulk upload completed  for Process ID: ${processId}`);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

export const migrateToMainAudio = async () => {
  const getAllAudioStage = await audioStageMetaData({ process_id: processId });
  if (getAllAudioStage?.error) {
    logger.error(`Validate Audio Stage:: ${processId}.`);
    return {
      error: { errStatus: 'errored', errMsg: 'error while get all stage data' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }

  const stagingDataChunks = chunk(getAllAudioStage, 100);

  const transaction = await AppDataSource.transaction();
  for (const chunk of stagingDataChunks) {
    try {
      const [audioInsertData, xIdAndQuestionsMap] = await formatAudioStageData(chunk);
      if (audioInsertData.length === 0) {
        return {
          error: { errStatus: 'process_stage_data', errMsg: 'Error in formatting staging data to main table.' },
          result: {
            isValid: false,
            data: null,
          },
        };
      }

      const audiosAlreadyCreated = await getAllAudioForHashes(audioInsertData.map((obj) => obj.description_hash));

      const audiosToBeCreated = uniqBy(
        audioInsertData.filter((obj) => !audiosAlreadyCreated.find((audio: any) => audio.description_hash === obj.description_hash)),
        'description_hash',
      );

      const newAudioRecords = await Promise.all(
        audiosToBeCreated.map(async (obj) => {
          const { data: speechData, error } = await ttsService.generateSpeech(obj.description_text, obj.language);

          if (error) {
            logger.error(`Error while synthesizing audio for ${obj.description_text} for ${obj.language} language`);
            return null;
          }

          const buffer = Buffer.from(speechData.audio[0].audioContent, 'base64');

          try {
            const filePath = `media/audio/${obj.description_hash}.mp3`;
            await uploadBufferToS3(buffer, filePath, 'audio/mp3');

            return {
              identifier: uuid.v4(),
              description_hash: obj.description_hash,
              audio_path: filePath,
              language: obj.language,
              created_by: 'system',
            };
          } catch (synthesisError: any) {
            logger.error(`Error while uploading audio for ${obj.description_text} for ${obj.language} language`);
            return null;
          }
        }),
      );

      const validAudioRecords = newAudioRecords.filter((record) => record !== null);

      const newAudiosToBeCreated = await createAudio(validAudioRecords, transaction);

      if (newAudiosToBeCreated.error) {
        await transaction.rollback();
        logger.error(`Error while creating audio records`);
        return { error: { errStatus: 'process_create_audio', errMsg: 'Error while creating audio records' }, result: { isValid: false, data: null } };
      }

      const allAudioRecords = audiosAlreadyCreated.concat(newAudiosToBeCreated.dataValues || []);

      if (allAudioRecords.length === 0) {
        await transaction.rollback();
        return { error: { errStatus: 'process_synthesize_audio', errMsg: 'No synthesized audio found.' }, result: { isValid: false, data: null } };
      }

      const xIdAudioMapping = audioInsertData.reduce((acc: any, curr: any) => {
        const audioRecord = allAudioRecords.find((audio: any) => audio.description_hash === curr.description_hash);

        if (!audioRecord) return acc;
        const key = `${curr.language}|${curr.xid}`;
        acc[key] = {
          ...(acc[key] || {}),
          [curr.language]: audioRecord,
        };
        return acc;
      }, {});

      const newAudioMappings: any[] = Object.keys(xIdAudioMapping)
        .map((key) => {
          const [language, xid] = key.split('|');
          return xIdAndQuestionsMap[xid].map((ques) => {
            return {
              audio_id: xIdAudioMapping[key][language].identifier,
              question_id: ques?.identifier,
              language,
              created_by: 'system',
            };
          });
        })
        .flat();

      if (newAudioMappings.length === 0) {
        await transaction.rollback();
        return { error: { errStatus: 'process_audio_mapping', errMsg: 'No audio mappings found.' }, result: { isValid: false, data: null } };
      }

      const audioMappings = await createAudioMapping(newAudioMappings, transaction);
      if (audioMappings.error) {
        await transaction.rollback();
        logger.error(`Error while creating audio mappings`);
        return { error: { errStatus: 'process_create_audio_mapping', errMsg: 'Error while creating audio mappings' }, result: { isValid: false, data: null } };
      }

      const mergedDescriptions = audioInsertData.reduce((acc: any, curr: any) => {
        const questions = xIdAndQuestionsMap[curr.xid];
        let desc = { ...curr.old_description_json };

        questions.forEach((question) => {
          desc = {
            ...desc,
            ...(question?.question_audio_description ?? {}),
            [curr.language]: curr.description_text,
          };
        });

        acc[curr.xid] = {
          ...(acc[curr.xid] || {}),
          ...desc,
        };
        return acc;
      }, {});

      const updatedQuestionData = audioInsertData
        .map((obj) => {
          return xIdAndQuestionsMap[obj.xid].map((questionData) => {
            return {
              ...questionData,
              tenant: questionData?.tenant || {},
              hints: questionData?.hints || [],
              question_audio_description: mergedDescriptions[obj.xid],
            };
          });
        })
        .flat();

      const validQuestionData = uniqBy(updatedQuestionData, 'identifier');

      const questions = await updateQuestion(validQuestionData, ['question_audio_description'], transaction);
      if (questions.error) {
        await transaction.rollback();
        logger.error(`Error while updating questions`);
        return { error: { errStatus: 'process_update_question', errMsg: 'Error while updating questions' }, result: { isValid: false, data: null } };
      }
    } catch (error: any) {
      await transaction.rollback();
      return {
        error: {
          errStatus: 'process_audio_insert',
          errMsg: 'Audio Transaction for chunk failed',
        },
        result: { isValid: false, data: null },
      };
    }
  }

  await transaction.commit();
  return { error: { errStatus: null, errMsg: null }, result: { isValid: true, data: null } };
};

const formatAudioStageData = async (stageData: any[]) => {
  try {
    const questionXids = stageData.map((obj) => obj.question_id);
    const allQuestions = await findExistingQuestionWithXIDs(questionXids);
    const xIdAndQuestionsMap = {} as Record<string, any[]>;
    const xidQuesMap = allQuestions.reduce((acc: any, curr: any) => {
      const { x_id } = curr;
      acc[x_id] = curr;
      xIdAndQuestionsMap[x_id] = xIdAndQuestionsMap[x_id] ? [...xIdAndQuestionsMap[x_id], curr] : [curr];
      return acc;
    }, {});

    const audioData: any[] = [];

    stageData
      .filter((item) => Boolean(xidQuesMap[item.question_id]))
      .forEach((obj) => {
        const questionAudioDesc = xidQuesMap[obj.question_id]?.question_audio_description ?? {};
        const audioLanguage = obj?.language;
        const newDescriptionHash = createHash('md5').update(`${obj?.audio_description}-${audioLanguage}`.replace(/\s+/g, '').toLowerCase()).digest('hex');

        if (questionAudioDesc && questionAudioDesc[audioLanguage]) {
          const oldDescriptionHash = createHash('md5').update(`${questionAudioDesc[audioLanguage]}-${audioLanguage}`.replace(/\s+/g, '').toLowerCase()).digest('hex');

          if (oldDescriptionHash === newDescriptionHash) return;
        }

        audioData.push({
          description_hash: newDescriptionHash,
          xid: obj?.question_id,
          language: obj?.language,
          description_text: obj?.audio_description,
          old_description_json: questionAudioDesc ?? {},
        });
      });

    return [audioData, xIdAndQuestionsMap] as const;
  } catch (error: any) {
    logger.error('Audio Insert main::Error while formatting data for main ', error.message);
    return [[] as any[], {} as Record<string, string[]>] as const;
  }
};
