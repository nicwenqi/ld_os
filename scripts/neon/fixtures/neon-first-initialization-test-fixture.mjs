export const authUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const target = {
  environment: "development",
  projectId: "fresh-neon-project",
  branchId: "br-fresh-neon",
  endpointId: "ep-fresh-neon",
  database: "neondb",
  directHostPrefix: "ep-fresh-neon.",
};

export const fixture = {
  seedVersion: "neon-first-development-v1",
  tenant: { id: "11111111-1111-4111-8111-111111111111", code: "demo-tenant", name: "Demo Tenant" },
  property: { id: "22222222-2222-4222-8222-222222222222", code: "DEMO-01", nameZh: "示范酒店", nameEn: "Demo Hotel", countryRegion: "CN", timezone: "Asia/Shanghai", defaultLanguage: "zh-CN" },
  propertyDomain: { id: "33333333-3333-4333-8333-333333333333", hostname: "demo.ldchub.test" },
  manager: {
    profileId: "44444444-4444-4444-8444-444444444444",
    accountId: "55555555-5555-4555-8555-555555555555",
    tenantMembershipId: "66666666-6666-4666-8666-666666666666",
    propertyMembershipId: "77777777-7777-4777-8777-777777777777",
    roleId: "88888888-8888-4888-8888-888888888888",
    roleAssignmentId: "99999999-9999-4999-8999-999999999999",
    displayName: "Development Manager",
    email: "manager@example.test",
    loginId: "development-manager",
  },
  initialization: {
    settingsId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    steps: {
      identity: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
      rules: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad",
      organization: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae",
      positions: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf",
      upload: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaba",
      mapping: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabb",
      access: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabc",
      readiness: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabd",
    },
  },
  developmentSeed: {
    departmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    positionFamilyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    positionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    positionDepartmentAssignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    employeeId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    employeeIdentifierId: "12121212-1212-4121-8121-121212121212",
  },
};
