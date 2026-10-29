CREATE TABLE s7_activity (
  id VARCHAR2(36) PRIMARY KEY,
  user_id VARCHAR2(36) NOT NULL REFERENCES s2_users(id) ON DELETE CASCADE,
  action VARCHAR2(40) NOT NULL,
  outcome VARCHAR2(20) NOT NULL,
  created_at TIMESTAMP DEFAULT SYS_EXTRACT_UTC(SYSTIMESTAMP) NOT NULL
)
;
CREATE INDEX s7_activity_owner ON s7_activity(user_id, created_at)
;
CREATE TABLE s7_usage (
  run_id VARCHAR2(36) PRIMARY KEY,
  user_id VARCHAR2(36) NOT NULL REFERENCES s2_users(id) ON DELETE CASCADE,
  model VARCHAR2(100) NOT NULL,
  input_tokens NUMBER NOT NULL CHECK (input_tokens >= 0),
  output_tokens NUMBER NOT NULL CHECK (output_tokens >= 0),
  total_tokens NUMBER NOT NULL CHECK (total_tokens = input_tokens + output_tokens),
  created_at TIMESTAMP DEFAULT SYS_EXTRACT_UTC(SYSTIMESTAMP) NOT NULL
)
;
CREATE INDEX s7_usage_owner ON s7_usage(user_id, created_at)
;
UPDATE s2_control SET version = 4 WHERE id = 1
;
