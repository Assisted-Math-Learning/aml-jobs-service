import logger from '../utils/logger';
import { Transaction } from 'sequelize';
import { QuestionSetQuestionMapping } from '../models/questionSetQuestionMapping';

export const createQuestionSetQuestionMapping = async (insertData: Array<Record<string, any>>, transaction: Transaction): Promise<any> => {
  try {
    await QuestionSetQuestionMapping.bulkCreate(insertData, { transaction });
    return { error: false, message: 'success' };
  } catch (error: any) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to create a record' : '';
    return { error: true, message: errorMsg };
  }
};
