export type OrganizationCandidateRow = {
  rowId: string;
  rowNumber: number;
  employeeNumber: string | null;
  name: string | null;
  sourceDepartment: string | null;
  normalizedDepartment: string | null;
  sourcePosition: string | null;
  normalizedPosition: string | null;
  sourceBand: string | null;
  normalizedBand: string | null;
  sourceEmploymentCategory: string | null;
  gender: string | null;
};

export type OrganizationCandidatePreview = {
  summary: {
    employees: number;
    departments: number;
    positions: number;
    bands: number;
    trainees: number;
    unresolvedEmployees: number;
  };
  departments: readonly DepartmentCandidate[];
  bands: readonly BandCandidate[];
  positions: readonly PositionCandidate[];
  employees: readonly EmployeeAttributionCandidate[];
};

export type DepartmentCandidate = {
  key: string;
  sourceValue: string;
  normalizedValue: string;
  employeeCount: number;
  action: "pending";
};

export type BandCandidate = {
  key: string;
  sourceValue: string;
  normalizedValue: string;
  employeeCount: number;
  positionCount: number;
  action: "pending";
};

export type PositionCandidate = {
  key: string;
  sourceValue: string;
  normalizedValue: string;
  departmentSource: string;
  departmentNormalized: string;
  employeeCount: number;
  bands: readonly string[];
  traineeCount: number;
  familySuggestion: null;
  action: "pending";
};

export type EmployeeAttributionCandidate = {
  rowId: string;
  rowNumber: number;
  employeeNumber: string | null;
  name: string | null;
  sourceDepartment: string | null;
  sourcePosition: string | null;
  sourceBand: string | null;
  band: string | null;
  employmentCategory: "Trainee" | null;
  gender: string | null;
  departmentCandidateKey: string | null;
  positionCandidateKey: string | null;
  status: "eligible" | "unable_to_determine";
  reasons: readonly string[];
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFKC").trim();
}

function keyPart(value: string): string {
  return clean(value).toLocaleLowerCase();
}

export function buildOrganizationCandidatePreview(rows: readonly OrganizationCandidateRow[]): OrganizationCandidatePreview {
  const departments = new Map<string, DepartmentCandidate & { count: number }>();
  const bands = new Map<string, BandCandidate & { count: number; positionKeys: Set<string> }>();
  const positions = new Map<string, PositionCandidate & { count: number; bandValues: Set<string>; traineeCount: number }>();
  const employees: EmployeeAttributionCandidate[] = [];

  for (const row of rows) {
    const departmentSource = clean(row.sourceDepartment) || null;
    const departmentNormalized = keyPart(row.normalizedDepartment || row.sourceDepartment);
    const positionSource = clean(row.sourcePosition) || null;
    const positionNormalized = keyPart(row.normalizedPosition || row.sourcePosition);
    const bandSource = clean(row.sourceBand) || null;
    const bandNormalized = keyPart(row.normalizedBand || row.sourceBand);
    const isTrainee = bandNormalized === "t" || keyPart(row.sourceEmploymentCategory) === "trainee";
    const departmentKey = departmentNormalized ? `department:${departmentNormalized}` : null;
    const positionKey = departmentNormalized && positionNormalized ? `position:${departmentNormalized}:${positionNormalized}` : null;

    if (departmentKey && departmentSource) {
      const candidate = departments.get(departmentKey);
      if (candidate) candidate.count += 1;
      else departments.set(departmentKey, { key: departmentKey, sourceValue: departmentSource, normalizedValue: departmentNormalized, employeeCount: 0, action: "pending", count: 1 });
    }

    if (bandNormalized && !isTrainee && bandSource) {
      const candidate = bands.get(`band:${bandNormalized}`);
      if (candidate) candidate.count += 1;
      else bands.set(`band:${bandNormalized}`, { key: `band:${bandNormalized}`, sourceValue: bandSource, normalizedValue: bandNormalized, employeeCount: 0, positionCount: 0, action: "pending", count: 1, positionKeys: new Set() });
    }

    if (positionKey && positionSource && departmentSource) {
      const candidate = positions.get(positionKey);
      if (candidate) {
        candidate.count += 1;
        if (bandSource && !isTrainee) candidate.bandValues.add(bandSource);
        if (isTrainee) candidate.traineeCount += 1;
      } else {
        positions.set(positionKey, { key: positionKey, sourceValue: positionSource, normalizedValue: positionNormalized, departmentSource, departmentNormalized, employeeCount: 0, bands: [], traineeCount: 0, familySuggestion: null, action: "pending", count: 1, bandValues: new Set(bandSource && !isTrainee ? [bandSource] : []), traineeCount: isTrainee ? 1 : 0 });
      }
      if (bandNormalized && !isTrainee) bands.get(`band:${bandNormalized}`)?.positionKeys.add(positionKey);
    }

    const reasons: string[] = [];
    if (!departmentNormalized) reasons.push("missing_department");
    if (!positionNormalized) reasons.push("missing_position");
    const employee: EmployeeAttributionCandidate = {
      rowId: row.rowId,
      rowNumber: row.rowNumber,
      employeeNumber: row.employeeNumber,
      name: row.name,
      sourceDepartment: departmentSource,
      sourcePosition: positionSource,
      sourceBand: bandSource,
      band: isTrainee || !bandSource ? null : bandSource,
      employmentCategory: isTrainee ? "Trainee" : null,
      gender: row.gender,
      departmentCandidateKey: departmentKey,
      positionCandidateKey: positionKey,
      status: reasons.length ? "unable_to_determine" : "eligible",
      reasons,
    };
    employees.push(employee);
    if (departmentKey) departments.get(departmentKey)!.employeeCount += 1;
    if (positionKey) positions.get(positionKey)!.employeeCount += 1;
    if (bandNormalized && !isTrainee) bands.get(`band:${bandNormalized}`)!.employeeCount += 1;
  }

  const departmentList = [...departments.values()].map(candidate => ({
    key: candidate.key,
    sourceValue: candidate.sourceValue,
    normalizedValue: candidate.normalizedValue,
    employeeCount: candidate.employeeCount,
    action: candidate.action,
  }));
  const bandList = [...bands.values()].map(candidate => ({
    key: candidate.key,
    sourceValue: candidate.sourceValue,
    normalizedValue: candidate.normalizedValue,
    employeeCount: candidate.employeeCount,
    positionCount: candidate.positionKeys.size,
    action: candidate.action,
  }));
  const positionList = [...positions.values()].map(candidate => ({
    key: candidate.key,
    sourceValue: candidate.sourceValue,
    normalizedValue: candidate.normalizedValue,
    departmentSource: candidate.departmentSource,
    departmentNormalized: candidate.departmentNormalized,
    employeeCount: candidate.employeeCount,
    bands: [...candidate.bandValues].sort(),
    traineeCount: candidate.traineeCount,
    familySuggestion: candidate.familySuggestion,
    action: candidate.action,
  }));
  return {
    summary: {
      employees: rows.length,
      departments: departmentList.length,
      positions: positionList.length,
      bands: bandList.length,
      trainees: employees.filter(employee => employee.employmentCategory === "Trainee").length,
      unresolvedEmployees: employees.filter(employee => employee.status === "unable_to_determine").length,
    },
    departments: departmentList,
    bands: bandList,
    positions: positionList,
    employees,
  };
}
