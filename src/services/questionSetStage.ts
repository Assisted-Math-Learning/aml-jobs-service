import { AppDataSource } from '../config';
import { QuestionSetStage } from '../models/questionSetStage';
import logger from '../utils/logger';

export const createQuestionSetStage = async (insertData: Array<Record<string, any>>): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const stagingData = await QuestionSetStage.bulkCreate(insertData, { transaction: transact });
    const [dataValues] = stagingData;
    await transact.commit();
    return { dataValues };
  } catch (error: any) {
    await transact.rollback();
    logger.error(error?.message);
    return { error: true, message: error?.message };
  }
};

export const questionSetStageMetaData = async (whereClause: any): Promise<any> => {
  try {
    const QuestionSets = await QuestionSetStage.findAll({ where: whereClause });
    const questionSets = QuestionSets.map((qs) => qs.dataValues);
    return questionSets;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get all record' : '';
    return { error: true, message: errorMsg };
  }
};

export const updateQuestionStageSet = async (whereClause: any, updateObj: any): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const updateQuestionSet = await QuestionSetStage.update(updateObj, { where: whereClause, transaction: transact });
    await transact.commit();
    return { error: false, updateQuestionSet };
  } catch (error) {
    await transact.rollback();
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to update a record' : '';
    return { error: true, message: errorMsg };
  }
};

export const getAllStageQuestionSet = async (): Promise<any> => {
  try {
    const QuestionSets = await QuestionSetStage.findAll({});
    const questionSets = QuestionSets.map((qs) => qs.dataValues);
    return questionSets;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get all record' : '';
    return { error: true, message: errorMsg };
  }
};
