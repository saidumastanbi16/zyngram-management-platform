const models = {
  Services: {
    id: "string",
    name: "string",
    category: "string",
    amount: "number | null",
    pricingType: "string",
    minAmount: "number | null",
    maxAmount: "number | null",
    operators: "object[]",
    circles: "string[]",
    status: "ACTIVE | INACTIVE"
  },
  Users: {
    id: "string",
    name: "string",
    mobile: "string",
    email: "string",
    role: "CUSTOMER | ADMIN | HQ | COMMAND | HUB | CENTER | EMPLOYEE",
    franchise_id: "string -> Franchises.id | null",
    status: "string",
    created_at: "datetime"
  },
  AuthSessions: {
    token_hash: "string (SHA-256; never store bearer token)",
    user_id: "string -> AuthAccounts.user_id",
    created_at: "datetime",
    expires_at: "datetime"
  },

  UserLocations: {
    id: "string",
    user_id: "string -> Users.id",
    lat: "number",
    lon: "number",
    accuracy: "number",
    address: "string",
    geography: "object | null",
    source: "string",
    captured_at: "datetime"
  },

  Franchises: {
    id: "string",
    level: "Point | Center | Hub | Command | Node | Zone | Territory | Region | Nation",
    name: "string",
    owner_id: "string -> Users.id",
    parent_id: "string -> Franchises.id | null",
    status: "string"
  },

  Employees: {
    id: "string",
    employee_id: "string (unique)",
    user_id: "string -> Users.id / AuthAccounts.user_id",
    zin_id: "string",
    name: "string",
    profile_photo_url: "string | null",
    mobile: "string",
    email: "string",
    date_of_birth: "date | null",
    gender: "string",
    address: "string",
    state: "string",
    district: "string",
    department: "string -> Departments.name",
    department_id: "string -> Departments.id | null",
    designation: "string -> Designations.name",
    designation_id: "string -> Designations.id | null",
    employment_type: "string",
    joining_date: "date",
    reporting_manager: "string",
    work_location: "string",
    franchise_id: "string -> Franchises.id",
    status: "ACTIVE | INACTIVE | RESIGNED | TERMINATED",
    created_at: "datetime",
    updated_at: "datetime"
  },

  Departments: { id: "string", name: "string", description: "string", status: "ACTIVE | INACTIVE" },
  Designations: { id: "string", name: "string", department_id: "string -> Departments.id | null", status: "ACTIVE | INACTIVE" },
  WorkLocations: { id: "string", name: "string", description: "string", status: "ACTIVE | INACTIVE" },
  EmployeeFranchiseMapping: { id: "string", employee_id: "string -> Employees.id", franchise_id: "string -> Franchises.id" },
  Attendance: {
    id: "string",
    employee_id: "string -> Employees.id",
    date: "date",
    check_in: "datetime | null",
    check_out: "datetime | null",
    work_location: "string",
    working_hours: "number",
    status: "PRESENT | ABSENT | HALF_DAY | LEAVE | HOLIDAY | WEEK_OFF",
    remarks: "string"
  },
  LeaveRequests: {
    id: "string",
    employee_id: "string -> Employees.id",
    leave_type: "string",
    start_date: "date",
    end_date: "date",
    reason: "string",
    supporting_document: "private base64 content | null",
    supporting_document_name: "string | null",
    supporting_document_type: "string | null",
    status: "PENDING | APPROVED | REJECTED | CANCELLED",
    reviewed_by: "string -> Users.id | null",
    requested_at: "datetime"
  },
  Targets: {
    id: "string",
    employee_id: "string -> Employees.id",
    period: "string",
    target_type: "string",
    target_value: "number",
    achievement: "number",
    achievement_percentage: "number",
    rating: "EXCEEDS | MEETS | BELOW",
    status: "ACHIEVED | IN_PROGRESS"
  },
  PerformanceRecords: {
    id: "string",
    employee_id: "string -> Employees.id",
    target_id: "string -> Targets.id",
    achievement_percentage: "number",
    rating: "string",
    recorded_at: "datetime"
  },
  EmployeeDocuments: {
    id: "string",
    employee_id: "string -> Employees.id",
    document_type: "string",
    file_name: "string",
    content_base64: "string (private)",
    expiry_date: "date | null",
    status: "ACTIVE | ARCHIVED",
    uploaded_by: "string -> Users.id",
    uploaded_at: "datetime"
  },
  Notifications: {
    id: "string",
    employee_id: "string -> Employees.id",
    type: "string",
    message: "string",
    read: "boolean",
    created_at: "datetime"
  },

  GeoBoundaries: {
    id: "string",
    franchise_id: "string -> Franchises.id",
    geometry: "object",
    version: "string",
    status: "string",
    supersedes: "string[]",
    created_at: "datetime"
  },

  Orders: {
    id: "string",
    customer_id: "string -> Users.id",
    service_id: "string -> ServiceCatalog.id",
    amount: "number",
    status: "string",
    location_id: "string -> UserLocations.id",
    created_at: "datetime"
  },

  OrderAttribution: {
    order_id: "string -> Orders.id",
    point_id: "string -> Franchises.id | null",
    center_id: "string -> Franchises.id | null",
    hub_id: "string -> Franchises.id | null",
    command_id: "string -> Franchises.id | null",
    node_id: "string -> Franchises.id | null",
    zone_id: "string -> Franchises.id | null",
    territory_id: "string -> Franchises.id | null",
    region_id: "string -> Franchises.id | null",
    nation_id: "string -> Franchises.id | null",
    mapping_version: "string",
    commission_rule_version: "string | null",
    commission_rules: "CommissionRules[]",
    coordinates: "object",
    attributed_at: "datetime"
  },

  CommissionRules: {
    rule_id: "string",
    service_id: "string -> ServiceCatalog.id",
    level: "Point | Center | Hub | Command",
    rate: "number",
    type: "percentage | fixed",
    effective_from: "datetime",
    effective_to: "datetime | null",
    version: "string",
    status: "string",
    configuration_type: "TEST_CONFIGURATION",
    created_at: "datetime"
  },

  CommissionLedger: {
    id: "string",
    order_id: "string -> Orders.id",
    owner_id: "string -> Users.id",
    level: "Point | Center | Hub | Command",
    rule_id: "string -> CommissionRules.rule_id",
    rate: "number",
    rule_version: "string",
    amount: "number",
    status: "Calculated | Pending | Eligible | Approved | Settled | Reversed",
    lifecycle_status: "CALCULATED | ELIGIBLE | APPROVED | SETTLED | REVERSED",
    calculation_status: "string",
    settlement_status: "Pending | Settled | Reversed",
    created_at: "datetime",
    settled_at: "datetime | null",
    settled_by: "string | null",
    reversed_at: "datetime | null",
    reversed_by: "string | null",
    reversal_reason: "string | null",
    reversed_settlement_at: "datetime | null"
  },

  WalletLedger: {
    id: "string",
    owner_id: "string -> Users.id",
    entry: "credit | debit",
    reference: "string",
    amount: "number",
    status: "string",
    created_at: "datetime",
    created_by: "string -> Users.id"
  },

  AuditLogs: {
    id: "string",
    actor_id: "string -> Users.id | SYSTEM",
    role: "string",
    action: "string",
    entity: "string",
    entity_id: "string",
    result: "string",
    metadata: "object",
    details: "object",
    timestamp: "datetime",
    created_at: "datetime"
  }
};

module.exports = models;