import type { WorkbookInspection } from "../../services/import/workbook-parser.ts";
export type ImportBatch={id:string;tenantId:string;propertyId:string;fileName:string;status:string;version:number;createdAt:string;summary:{inserted:number;updated:number;unchanged:number;excluded:number;unresolved:number}};
export type ImportIssue={id:string;rowNumber:number;sheetName:string;type:string;severity:"warning"|"error";field:string|null;value:string|null;message:string;resolutionStatus:string};
export interface ImportRepository {
  createBatch(input:{tenantId:string;propertyId:string;fileName:string;mimeType:string;sizeBytes:number;checksum:string;sourceSystem:string}):Promise<ImportBatch>;
  uploadFileReference(batchId:string,file:File):Promise<{objectPath:string}>; inspectWorkbook(batchId:string):Promise<WorkbookInspection>;
  listSheets(batchId:string):Promise<readonly unknown[]>; selectSheet(sheetId:string,selected:boolean,headerRow:number):Promise<void>;
  saveFieldMappings(batchId:string,mappings:readonly unknown[]):Promise<void>; stageRows(batchId:string,rows:readonly unknown[]):Promise<void>;
  listDepartmentLabels(batchId:string):Promise<readonly unknown[]>; listPositionLabels(batchId:string):Promise<readonly unknown[]>;
  validateBatch(batchId:string):Promise<ImportBatch>; listIssues(batchId:string):Promise<readonly ImportIssue[]>;
  resolveIssue(issueId:string,resolution:{status:string;correctedValue?:string}):Promise<void>; previewCommit(batchId:string):Promise<ImportBatch["summary"]>;
  commitBatch(batchId:string,expectedVersion:number):Promise<string>; previewRevert(batchId:string):Promise<{safe:boolean;conflicts:number;strategy:string}>;
  revertBatch(batchId:string):Promise<void>; listImportHistory(propertyId:string):Promise<readonly ImportBatch[]>; getBatchAudit(batchId:string):Promise<readonly unknown[]>;
}
