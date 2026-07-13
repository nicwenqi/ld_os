export type StagingCandidate = {
  employeeNumber: unknown;
  nameZh: unknown;
  department: unknown;
  position: unknown;
  hireDateValid: boolean;
  excluded?: boolean;
};

export function isMissingSourceValue(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim().length === 0);
}

export function classifyEmployeeStagingRows(rows: readonly StagingCandidate[]) {
  const employeeNumbers = new Map<string, number>();
  for (const row of rows) if (!isMissingSourceValue(row.employeeNumber)) {
    const value = String(row.employeeNumber);
    employeeNumbers.set(value, (employeeNumbers.get(value) ?? 0) + 1);
  }
  let missingEmployeeNumber = 0, missingName = 0, missingDepartment = 0, missingPosition = 0, duplicateEmployeeNumber = 0, invalidDate = 0, excluded = 0, structurallyValid = 0;
  for (const row of rows) {
    if (row.excluded) { excluded += 1; continue; }
    const numberMissing = isMissingSourceValue(row.employeeNumber);
    const nameMissing = isMissingSourceValue(row.nameZh);
    const departmentMissing = isMissingSourceValue(row.department);
    const positionMissing = isMissingSourceValue(row.position);
    const duplicate = !numberMissing && (employeeNumbers.get(String(row.employeeNumber)) ?? 0) > 1;
    if (numberMissing) missingEmployeeNumber += 1;
    if (nameMissing) missingName += 1;
    if (departmentMissing) missingDepartment += 1;
    if (positionMissing) missingPosition += 1;
    if (duplicate) duplicateEmployeeNumber += 1;
    if (!row.hireDateValid) invalidDate += 1;
    if (!numberMissing && !nameMissing && !departmentMissing && !positionMissing && !duplicate && row.hireDateValid) structurallyValid += 1;
  }
  return {
    totalCandidates: rows.length,
    structurallyValid,
    missingEmployeeNumber,
    missingName,
    missingDepartment,
    missingPosition,
    duplicateEmployeeNumber,
    invalidDate,
    readyAfterMapping: structurallyValid,
    explicitlyExcluded: excluded,
  };
}
