CREATE TABLE s3_attachments (
  message_id VARCHAR2(36) PRIMARY KEY REFERENCES s3_messages(id) ON DELETE CASCADE,
  content CLOB NOT NULL
)
;
UPDATE s2_control SET version = 5 WHERE id = 1
;
