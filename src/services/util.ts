import logger from '../utils/logger';
import { getAWSFolderData, uploadCsvFile } from '../services/awsService';
import AdmZip from 'adm-zip';
import _, { isArray, isEmpty, isNaN } from 'lodash';
import { Parser } from '@json2csv/plainjs';
import { getBoards, getClasses, getRepository, getSkills, getSubSkills, getTenants } from '../services/service';
import { appConfiguration } from '../config';
import { Board, Class, Skill, SubSkill, UniqueValues, Mismatches } from '../types/util';
import * as uuid from 'uuid';
import papaparse from 'papaparse';
import * as fs from 'node:fs';
import appRootPath from 'app-root-path';
import path from 'path';

const { bulkUploadFolder, templateFileName, templateFolder } = appConfiguration;

let processId: string;

export const fetchAndExtractZipEntries = async (key: string, process_id: string, fileName?: string) => {
  processId = process_id;
  try {
    let bulkUploadStream;
    if (key === 'upload') {
      bulkUploadStream = await getAWSFolderData(`${bulkUploadFolder}/${process_id}/${fileName}`);
    } else {
      bulkUploadStream = await getAWSFolderData(`${templateFolder}/${templateFileName}`);
    }
    const bulkUploadBuffer = (await streamToBuffer(bulkUploadStream)) as Buffer;
    const bulkUploadZip = new AdmZip(bulkUploadBuffer);
    logger.info('Cloud Process:: converted stream to zip entries');
    return {
      error: null,
      result: {
        isValid: true,
        data: bulkUploadZip.getEntries(),
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error in the validation process,please re-upload the zip file for the new process';
    logger.error(errorMsg);
    return {
      error: null,
      result: {
        isValid: false,
        data: [],
      },
    };
  }
};

export const streamToBuffer = (stream: any) => {
  return new Promise((resolve, reject) => {
    const chunks: any = [];
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};

export const getCSVTemplateHeader = async (entryName: string) => {
  const templateZipEntries = await fetchAndExtractZipEntries('template', processId);
  const templateFileContent = templateZipEntries?.result?.data
    .find((t) => t?.entryName === entryName)
    ?.getData()
    .toString('utf8');
  if (!templateFileContent) {
    logger.error(`Template:: The file '${entryName}' does not match the expected CSV format.`);
    return {
      error: { errStatus: 'invalid_template', errMsg: `Template for '${entryName}' not found.`, status: 'failed' },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  const [templateHeader] = templateFileContent.split('\n').map((row) => row.split(','));
  const cleanHeader = templateHeader?.map((cell: string) => cell.replace(/\r/g, '').trim());
  logger.info('Template:: template header extracted.');
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: cleanHeader,
    },
  };
};

export const getCSVEntries = (csvFile: any) => {
  const filePath = path.join(appRootPath.path, 'tmp', `data.csv`);
  fs.writeFileSync(filePath, csvFile.getData());
  const localCSVFile = fs.readFileSync(filePath, 'utf-8');
  const csvRows = papaparse.parse(localCSVFile)?.data;
  fs.unlinkSync(filePath);
  return csvRows as string[][];
};

const processEachField = (value: any, header: any) => {
  const headerName = header?.trim();

  // Handle 'grid1_show_carry' and 'grid1_show_regroup' fields
  if (headerName?.includes('grid1_show_carry') || headerName?.includes('grid1_show_regroup')) {
    value = value === undefined || value.trim() === '' ? 'no' : value;
  }

  //handle to make array fo string of l2 ,l3 and sub skills
  else if (headerName?.includes('l2_skill') || headerName?.includes('l3_skill')) {
    value = typeof value === 'string' ? (isEmpty(value) ? [] : value.includes('#') ? value.split('#').map((val) => val.trim()) : [value.trim()]) : value.trim();
  } else if (headerName === 'is_atomic') {
    value = value ? value : false;
  } else if (headerName.includes('sequence')) {
    value = isEmpty(value) ? null : Number(value);
  } else if (headerName.includes('benchmark_time')) {
    value = isEmpty(value) ? 100 : Number(value);
    if (isNaN(value)) {
      value = 100;
    }
  }

  // Handle 'media' fields
  else if (headerName === 'instruction_media') {
    value = value ? value?.split('#') : [value];
  } else if (headerName === 'media_file') {
    value = isEmpty(value) ? [] : value.includes('#') ? value.split('#').map((m: string) => m.trim()) : value.trim();
  }

  // Handle sub skills.
  else if (headerName?.includes('QID')) {
    value = value?.trim();
  } else if (
    headerName?.includes('x_plus_x') ||
    headerName?.includes('procedural') ||
    headerName?.includes('carry') ||
    headerName?.includes('x_plus_0') ||
    headerName?.includes('0_plus_x') ||
    headerName?.includes('procedure') ||
    headerName?.includes('uneq_pvp')
  ) {
    value = isEmpty(value) ? [] : value.includes('#') ? value.split('#') : [String(value)];
  } else if (headerName.includes('sub_skill')) {
    value = isEmpty(value) ? [] : value.includes('#') ? value.split('#') : [String(value)];
  }

  return value;
};

export const getCSVHeaderAndRow = (csvEntries: any) => {
  try {
    const csvData = csvEntries?.getData()?.toString('utf8');

    // Use PapaParse to parse the CSV data
    const parsedResult = papaparse?.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      transform: (value, header) => processEachField(value, header),
    });

    if (parsedResult.errors.length) {
      return {
        error: { errStatus: 'Unexpected error', errMsg: `Parsing errors: ${parsedResult.errors.map((err) => err.message).join(', ')}` },
        result: {
          isValid: false,
          data: { header: '', rows: '' },
        },
      };
    }

    const cleanHeader = parsedResult?.meta?.fields;
    const cleanRows = parsedResult?.data;

    return {
      error: { errStatus: null, errMsg: null },
      result: {
        isValid: true,
        data: { header: cleanHeader, rows: cleanRows },
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error while accessing the row and header';
    return {
      error: { errStatus: 'Unexpected error', errMsg: errorMsg },
      result: {
        isValid: false,
        data: { header: '', rows: '' },
      },
    };
  }
};

export const validateHeader = (entryName: string, header: any, templateHeader: any) => {
  if (header?.length !== templateHeader?.length) {
    logger.error(`Header Validate:: CSV file contains more/less fields compared to the template.`);
    return {
      error: { errStatus: 'Header validate', errMsg: `The file '${entryName}' does not matched with header length.` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }

  const mismatchedColumns: string[] = [];
  const validHeader = templateHeader?.every((col: string, i: number) => {
    if (col !== header[i]) {
      mismatchedColumns.push(`Expected: '${col}', Found: '${header[i]}'`);
      return false;
    }
    return true;
  });
  if (!validHeader) {
    logger.error(`Header validate:: The file '${entryName}' does not match the expected CSV format. Mismatched columns: ${mismatchedColumns.join(', ')}`);
    return {
      error: { errStatus: 'Header validate', errMsg: `The file '${entryName}' does not match the exact column names. Mismatched columns: ${mismatchedColumns.join(', ')}` },
      result: {
        isValid: false,
        data: null,
      },
    };
  }
  logger.info(`Header validate:: ${entryName} contain valid header`);
  return {
    error: { errStatus: null, errMsg: null },
    result: {
      isValid: true,
      data: null,
    },
  };
};

export const processRow = (rows: any) => {
  try {
    let errMsg = '';
    const finalJsonForInsert = rows?.map((row: any) => {
      row.body = {};

      Object.keys(row).forEach((headerName: string) => {
        const cellValue = row[headerName];

        if (headerName === 'mcq_correct_options' && row?.question_type === 'Mcq') {
          const cellValueTokens = cellValue.trim().split(' ');
          if (cellValueTokens.length !== 2 || cellValueTokens[0].toLowerCase() !== 'option' || Number.isNaN(+cellValueTokens[1])) {
            errMsg = 'Invalid value format for mcq_correct_options column :: should be Option<space><option-number>';
          }

          if (!errMsg) {
            const optionHeaders = ['mcq_option_1', 'mcq_option_2', 'mcq_option_3', 'mcq_option_4', 'mcq_option_5', 'mcq_option_6'];
            const options = optionHeaders.map((option: any) => row[option]).filter((v) => !!v);
            const cellValueTokens = cellValue.trim().split(' ');
            const correctOptionNumber = +cellValueTokens[1];
            if (correctOptionNumber > options.length) {
              errMsg = `Invalid value for mcq_correct_options column :: Options: ${options.join(', ')}`;
            }
          }
        }

        // Add fields matching the mcq, fib, grid, n1, n2 pattern to body
        if (
          headerName.startsWith('mcq') ||
          headerName.startsWith('fib') ||
          headerName.startsWith('grid') ||
          headerName.includes('n1') ||
          headerName.includes('n2') ||
          headerName.endsWith('question_image')
        ) {
          row.body[headerName] = cellValue ? String(cellValue) : '';
        } else if (headerName?.includes('media_file')) {
          row.media_files = row?.media_files || [];
          if (!isArray(cellValue) && !isEmpty(cellValue)) row?.media_files?.push(cellValue);
        }
      });

      row['identifier'] = uuid.v4();
      row['process_id'] = processId;
      row['created_by'] = 'system';

      return row;
    });

    if (errMsg) {
      logger.error(errMsg);
      return { data: [], errMsg };
    }

    return { data: finalJsonForInsert, errMsg: null };
  } catch (error: any) {
    logger.error(error.message);
    return { data: [], errMsg: 'error in processing row ad json for inserting to staging' };
  }
};

export const getUniqueValues = (data: any[]): UniqueValues => {
  const keys = ['l1_skill', 'l2_skill', 'l3_skill', 'board', 'class', 'sub_skills', 'repository_name'];

  return _.reduce(
    keys,
    (acc: any, key) => {
      if (key === 'l2_skill' || key === 'l3_skill' || key === 'sub_skills') {
        acc[key] = _.uniq(_.flatten(data.map((item) => item[key] || []))).filter((value) => value !== undefined && value !== '');
      } else {
        acc[key] = _.uniqBy(data, key)
          .map((item) => item[key])
          .filter((value) => value !== undefined && value !== '');
      }
      return acc;
    },
    {},
  ) as UniqueValues;
};

export const checkValidity = async (data: any[]): Promise<{ error: { errStatus: string | null; errMsg: string | null }; result: { isValid: boolean; data: any } }> => {
  const uniqueValues: UniqueValues = getUniqueValues(data);
  const { boards, classes, skills, subSkills, repositories } = await preloadData();

  const mismatches: Mismatches = {
    boards: _.difference(
      uniqueValues.board,
      boards.flatMap((board: Board) => board?.name?.en),
    ),
    classes: _.difference(
      uniqueValues.class,
      classes.flatMap((Class: Class) => Class?.name?.en),
    ),
    repository_name: _.difference(
      uniqueValues.repository_name || [],
      repositories.flatMap((repo: Board) => repo?.name?.en),
    ),
    l1_skill: _.difference(
      uniqueValues.l1_skill,
      skills.filter((skill: Skill) => skill.type === 'l1_skill').map((skill: Skill) => skill?.name?.en),
    ),
    l2_skill: _.difference(
      uniqueValues.l2_skill,
      skills.filter((skill: Skill) => skill.type === 'l2_skill').map((skill: Skill) => skill?.name?.en),
    ),
    l3_skill: _.difference(
      _.flatMap(uniqueValues.l3_skill),
      skills.filter((skill: Skill) => skill.type === 'l3_skill').map((skill: Skill) => skill?.name?.en),
    ),
    sub_skills: _.difference(
      uniqueValues.sub_skills,
      subSkills.flatMap((Sub_skill: SubSkill) => Sub_skill?.name?.en),
    ),
  };

  const hasMismatch = _.some(_.values(mismatches), (arr) => arr.length > 0);

  if (hasMismatch) {
    const mismatchedFields = Object.entries(mismatches)
      .filter(([, mismatchArray]) => mismatchArray.length > 0)
      .map(([field, mismatchedArray]) => `${field}: ${mismatchedArray.join(', ')}`)
      .join('; ');
    logger.error(`One or more values do not match the preloaded data.${mismatchedFields}`);
    return {
      error: { errStatus: 'Mismatch', errMsg: `One or more values do not match the preloaded data.${mismatchedFields}` },
      result: { isValid: false, data: [mismatchedFields] },
    };
  }

  return {
    error: { errStatus: null, errMsg: null },
    result: { isValid: true, data: uniqueValues },
  };
};

export const convertToCSV = async (jsonData: any, fileName: string) => {
  const json2csvParser = new Parser();
  const csv = json2csvParser.parse(jsonData);
  const uploadMediaFile = await uploadCsvFile(csv, `upload/${processId}/${fileName}.csv`);
  logger.info(`CSV:: csv file created from staging data for ${fileName}`);
  return uploadMediaFile;
};

export const preloadData = async () => {
  const [boards, classes, skills, subSkills, tenants, repositories] = await Promise.all([getBoards(), getClasses(), getSkills(), getSubSkills(), getTenants(), getRepository()]);
  logger.info('Preloaded:: preloading metadata from table.');
  return {
    boards,
    classes,
    skills,
    tenants,
    subSkills,
    repositories,
  };
};
