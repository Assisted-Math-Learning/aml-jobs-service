import { AppDataSource } from '../config';
import { QuestionStage } from '../models/questionStage';
import logger from '../utils/logger';

export const createQuestionStage = async (insertData: Array<Record<string, any>>): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const stagingData = await QuestionStage.bulkCreate(insertData, { transaction: transact });
    await transact.commit();
    const [dataValues] = stagingData;
    return { error: false, dataValues };
  } catch (error: any) {
    const fields = error?.fields;
    await transact.rollback();
    logger.error(error?.message);
    return { error: true, message: `${error?.original?.message} ${fields ? JSON.stringify(fields) : ''}`.trim() };
  }
};

export const questionStageMetaData = async (whereClause: any): Promise<any> => {
  try {
    const Questions = await QuestionStage.findAll({ where: whereClause });
    const questions = Questions.map((q) => q.dataValues);
    return questions;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get all record' : '';
    return { error: true, message: errorMsg };
  }
};

export const updateQuestionStage = async (whereClause: any, updateObj: any): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const updateQuestionStage = await QuestionStage.update(updateObj, { where: whereClause, transaction: transact });
    await transact.commit();
    return { error: false, updateQuestionStage };
  } catch (error) {
    await transact.rollback();
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to update a record' : '';
    return { error: true, message: errorMsg };
  }
};

export const getAllStageQuestion = async (): Promise<any> => {
  try {
    const Questions = await QuestionStage.findAll({});
    const questions = Questions.map((q) => q.dataValues);
    return questions;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get all record' : '';
    return { error: true, message: errorMsg };
  }
};
