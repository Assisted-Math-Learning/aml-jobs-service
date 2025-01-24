import { Op, Transaction } from 'sequelize';
import { AudioMaster } from '../models/audioMaster';
import logger from '../utils/logger';
import { AudioQuestionMapping } from '../models/questionAudioMapping';

export const deleteAudios = async (whereClause: any): Promise<any> => {
  try {
    await AudioMaster.destroy({
      where: {
        question_id: {
          [Op.in]: whereClause,
        },
      },
    });
    return { error: false };
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to delete records' : '';
    return { error: true, message: errorMsg };
  }
};

export const deleteAudioMappings = async (whereClause: any): Promise<any> => {
  try {
    await AudioQuestionMapping.destroy({
      where: {
        identifier: {
          [Op.in]: whereClause,
        },
      },
    });
    return { error: false };
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to delete records' : '';
    return { error: true, message: errorMsg };
  }
};

export const getAllAudioForHashes = async (audioHashes: string[]): Promise<any> => {
  try {
    const audios = await AudioMaster.findAll({
      where: {
        description_hash: {
          [Op.in]: audioHashes,
        },
      },
      raw: true,
      attributes: ['identifier', 'description_hash', 'audio_path', 'language', 'created_by', 'updated_by'],
    });
    return audios;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get all record' : '';
    return { error: true, message: errorMsg };
  }
};

export const createAudio = async (insertData: Array<Record<string, any>>, transaction: Transaction): Promise<any> => {
  try {
    const stagingData = await AudioMaster.bulkCreate(insertData, { transaction });
    return { error: false, message: 'success', dataValues: stagingData };
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to create a record' : '';
    return { error: true, message: errorMsg };
  }
};

export const createAudioMapping = async (insertData: Array<Record<string, any>>, transaction: Transaction): Promise<any> => {
  try {
    const stagingData = await AudioQuestionMapping.bulkCreate(insertData, { transaction });
    const [dataValues] = stagingData;
    return { error: false, message: 'success', dataValues };
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to create a record' : '';
    return { error: true, message: errorMsg };
  }
};
