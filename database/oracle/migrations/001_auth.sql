-- Applied statement-by-statement by the migration CLI. Oracle 19c+, AL32UTF8.
CREATE TABLE s2_control (id NUMBER PRIMARY KEY, version NUMBER NOT NULL)
;
INSERT INTO s2_control (id, version) VALUES (1, 0)
;
CREATE TABLE s2_users (
  id VARCHAR2(36) PRIMARY KEY,
  username VARCHAR2(64) NOT NULL UNIQUE,
  password_hash VARCHAR2(256) NOT NULL,
  role VARCHAR2(10) NOT NULL CHECK (role IN ('admin', 'user')),
  active NUMBER(1) DEFAULT 1 NOT NULL CHECK (active IN (0, 1))
)
;
CREATE TABLE s2_sessions (
  token_hash VARCHAR2(64) PRIMARY KEY,
  user_id VARCHAR2(36) NOT NULL REFERENCES s2_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL
)
;
CREATE INDEX s2_session_owner ON s2_sessions(user_id)
;
CREATE TABLE s2_settings (
  user_id VARCHAR2(36) PRIMARY KEY REFERENCES s2_users(id) ON DELETE CASCADE,
  theme VARCHAR2(10) DEFAULT 'system' NOT NULL CHECK (theme IN ('light', 'dark', 'system'))
)
;
CREATE TABLE s2_conversations (
  id VARCHAR2(36) PRIMARY KEY,
  user_id VARCHAR2(36) NOT NULL REFERENCES s2_users(id) ON DELETE CASCADE,
  title NVARCHAR2(200) NOT NULL
)
;
CREATE INDEX s2_conversation_owner ON s2_conversations(user_id)
;
CREATE TABLE s2_login_limits (
  key_hash VARCHAR2(64) PRIMARY KEY,
  attempts NUMBER DEFAULT 0 NOT NULL,
  reset_at TIMESTAMP NOT NULL
)
;
UPDATE s2_control SET version = 1 WHERE id = 1
;
