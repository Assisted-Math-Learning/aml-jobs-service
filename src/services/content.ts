import { Op } from 'sequelize';
import { AppDataSource } from '../config';
import { Content } from '../models/content';
import logger from '../utils/logger';

export const createContent = async (insertData: Array<Record<string, any>>): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const insertContent = await Content.bulkCreate(insertData, { transaction: transact });
    await transact.commit();
    return { insertContent };
  } catch (error) {
    await transact.rollback();
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to create a record' : '';
    return { error: true, message: errorMsg };
  }
};

export const getContents = async (): Promise<any> => {
  try {
    const contents = await Content.findAll({
      attributes: ['id', 'content_id', 'identifier'],
      raw: true,
    });
    return contents;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get records' : '';
    return { error: true, message: errorMsg };
  }
};

export const deleteContents = async (whereClause: any): Promise<any> => {
  try {
    await Content.destroy({
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

export const findExistingContentXIDs = async (xids: string[]): Promise<any> => {
  return Content.findAll({
    where: {
      x_id: xids,
    },
    raw: true,
    attributes: ['x_id'],
    group: 'x_id',
  });
};
