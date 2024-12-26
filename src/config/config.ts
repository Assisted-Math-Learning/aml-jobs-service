// import dotenv from 'dotenv';
import { get, isEqual } from 'lodash';
import { IConfiguration } from './interfaces';

const envVars = process.env;

const appConfiguration: IConfiguration = {
  log: {
    day: get(envVars, 'LOG_FILE_DAY', '14d'),
    isEnable: isEqual(get(envVars, 'LOG_FILE_ENABLE', 'true'), 'true'),
    name: get(envVars, 'LOG_FILE_NAME', 'AML-job-log'),
    size: get(envVars, 'LOG_FILE_SIZE', '20m'),
    zippedArchive: isEqual(get(envVars, 'LOG_FILE_ZIP_ARCHIVE', 'false'), 'true'),
  },
  envPort: get(envVars, 'AML_SERVICE_APPLICATION_PORT', 4000) as number,
  applicationEnv: get(envVars, 'AML_SERVICE_APPLICATION_ENV', 'development'),
  appVersion: get(envVars, 'AML_SERVICE_APP_VERSION', '1.0'),
  DB: {
    host: get(envVars, 'AML_SERVICE_DB_HOST', 'localhost'),
    port: get(envVars, 'AML_SERVICE_DB_PORT', 5432) as number,
    password: get(envVars, 'AML_SERVICE_DB_PASS', 'postgres'),
    name: get(envVars, 'AML_SERVICE_DB_NAME', 'postgres'),
    user: get(envVars, 'AML_SERVICE_DB_USER', 'postgres'),
  },
  bucketName: get(envVars, 'BUCKET_NAME', ''),
  csvFileName: get(
    envVars,
    'CSV_FILE_NAME',
    'division-question.csv,multiply-question.csv,addition-question.csv,subtraction-question.csv,media,division-questionSet.csv,multiply-questionSet.csv,addition-questionSet.csv,subtraction-questionSet.csv,division-content.csv,multiply-content.csv,addition-content.csv,subtraction-content.csv',
  ).split(','),
  presignedUrlExpiry: get(envVars, 'PRESIGNED_URL_EXPIRY_TIME', 600) as number,
  processInterval: get(envVars, 'PROCESS_INTERVAL', 300000) as number,
  reCheckProcessInterval: get(envVars, 'RE_CHECK_PROCESS_INTERVAL', 4) as number, //hours
  fileUploadInterval: get(envVars, 'FILE_UPLOAD_INTERVAL', 4) as number, //hours
  grid1AddFields: get(envVars, 'GRID-1_ADD_FIELDS', 'grid1_show_carry,grid_fib_n1,grid_fib_n2').split(','),
  grid1SubFields: get(envVars, 'GRID-1_SUB_FIELDS', 'grid1_show_regroup,grid_fib_n1,grid_fib_n2').split(','),
  grid1MultipleFields: get(envVars, 'GRID-1_MULTIPLE_FIELDS', 'grid_fib_n1,grid_fib_n2').split(','),
  grid1DivFields: get(envVars, 'GRID-1_DIVISION_FIELDS', 'grid_fib_n1,grid_fib_n2').split(','),
  grid2Fields: get(envVars, 'GRID-2_FIELDS', 'grid_fib_n1,grid_fib_n2').split(','),
  fibFields: get(envVars, 'FIB_FIELDS', 'grid_fib_n1,grid_fib_n2,fib_type,fib_answer,question_image').split(','),
  mcqFields: get(envVars, 'MCQ_FIELDS', 'question_text,question_image,mcq_option_1,mcq_option_2,mcq_option_3,mcq_option_4,mcq_option_5,mcq_option_6,mcq_correct_options').split(','),
  templateFileName: get(envVars, 'TEMPLATE_FILE_NAME', 'bulk_upload.zip'),
  templateFolder: get(envVars, 'TEMPLATE_FOLDER', 'template'),
  bulkUploadFolder: get(envVars, 'BULK_UPLOAD_FOLDER', 'upload'),
  aws: {
    secretKey: get(envVars, 'AML_AWS_SECRET_KEY', ''),
    accessKey: get(envVars, 'AML_AWS_ACCESS_KEY', ''),
    bucketRegion: get(envVars, 'AML_AWS_BUCKET_REGION', 'us-east-1'),
    bucketOutput: get(envVars, 'AML_AWS_BUCKET_OUTPUT', 'table'),
  },
  questionBodyFields: get(
    envVars,
    'QUESTION_BODY_FIELDS',
    'question_image,grid1_show_carry,grid_fib_n1,grid_fib_n2,fib_type,fib_answer,mcq_option_1,mcq_option_2,mcq_option_3,mcq_option_4,mcq_option_5,mcq_option_6,mcq_correct_options,grid2_pre_fills_n1,grid2_pre_fills_n2,grid1_pre_fills_top,grid1_pre_fills_result,grid1_pre_fills_remainder,grid1_pre_fills_quotient,grid1_multiply_intermediate_steps_prefills,grid1_pre_fills_result',
  ).split(','),
  mediaFields: get(envVars, 'MEDIA_FIELDS', 'media_file_1,media_file_2,media_file_3,media_file_4,media_file_5').split(','),
  requiredMetaFields: get(
    envVars,
    'REQUIRED_META_FIELDS',
    'l1_skill,l2_skill,class,board,sequence,question_type,repository_name,benchmark_time,identifier,process_id,content_id,QID,question_set_id',
  ).split(','),
};

export default appConfiguration;
