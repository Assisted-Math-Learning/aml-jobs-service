// Define the IConfiguration interface
export interface IConfiguration {
  log: {
    day: string;
    isEnable: boolean;
    name: string;
    size: string;
    zippedArchive: boolean;
  };
  envPort: number;
  applicationEnv: string;
  appVersion: string;
  DB: {
    port: number;
    host: string;
    password: string;
    user: string;
    name: string;
  };
  bucketName: string;
  csvFileName: string[];
  presignedUrlExpiry: number;
  processInterval: number;
  reCheckProcessInterval: number;
  fileUploadInterval: number;
  grid1AddFields: string[];
  grid1SubFields: string[];
  grid1MultipleFields: string[];
  grid1DivFields: string[];
  grid2Fields: string[];
  fibFields: string[];
  mcqFields: string[];
  templateFileName: string;
  templateFolder: string;
  bulkUploadFolder: string;
  aws: {
    secretKey: string;
    accessKey: string;
    bucketRegion: string;
    bucketOutput: string;
  };
  questionBodyFields: string[];
  mediaFields: string[];
  requiredMetaFields: string[];
}
