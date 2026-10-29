CREATE TABLE s4_teams (
  id VARCHAR2(36) PRIMARY KEY,
  name NVARCHAR2(100) NOT NULL
)
;
CREATE TABLE s4_members (
  team_id VARCHAR2(36) NOT NULL REFERENCES s4_teams(id) ON DELETE CASCADE,
  user_id VARCHAR2(36) NOT NULL REFERENCES s2_users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
)
;
CREATE INDEX s4_member_user ON s4_members(user_id)
;
CREATE TABLE s4_documents (
  id VARCHAR2(36) PRIMARY KEY,
  owner_id VARCHAR2(36) NOT NULL REFERENCES s2_users(id) ON DELETE CASCADE,
  team_id VARCHAR2(36) REFERENCES s4_teams(id) ON DELETE CASCADE,
  name NVARCHAR2(200) NOT NULL,
  chunk_count NUMBER NOT NULL
)
;
CREATE INDEX s4_document_owner ON s4_documents(owner_id)
;
CREATE INDEX s4_document_team ON s4_documents(team_id)
;
CREATE TABLE s4_chunks (
  document_id VARCHAR2(36) NOT NULL REFERENCES s4_documents(id) ON DELETE CASCADE,
  ordinal NUMBER NOT NULL,
  location NVARCHAR2(200) NOT NULL,
  content NVARCHAR2(1500) NOT NULL,
  PRIMARY KEY (document_id, ordinal)
)
;
CREATE TABLE s4_citations (
  message_id VARCHAR2(36) PRIMARY KEY REFERENCES s3_messages(id) ON DELETE CASCADE,
  content CLOB NOT NULL
)
;
UPDATE s2_control SET version = 3 WHERE id = 1
;
