import { Op } from 'sequelize';
import { AppDataSource } from '../config';
import { Question } from '../models/question';
import logger from '../utils/logger';

export const createQuestion = async (insertData: Array<Record<string, any>>): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const stagingData = await Question.bulkCreate(insertData, { transaction: transact });
    const [dataValues] = stagingData;
    await transact.commit();
    return { error: false, message: 'success', dataValues };
  } catch (error) {
    await transact.rollback();
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to create a record' : '';
    return { error: true, message: errorMsg };
  }
};

export const deleteQuestions = async (whereClause: any): Promise<any> => {
  try {
    await Question.destroy({
      where: {
        process_id: {
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
