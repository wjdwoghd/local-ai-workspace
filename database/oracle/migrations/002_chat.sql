-- Chat history contains only completed turns. Generation leases survive server restarts.
CREATE TABLE s3_messages (
  id VARCHAR2(36) PRIMARY KEY,
  conversation_id VARCHAR2(36) NOT NULL REFERENCES s2_conversations(id) ON DELETE CASCADE,
  ordinal NUMBER NOT NULL,
  role VARCHAR2(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  content CLOB NOT NULL,
  model VARCHAR2(100) NOT NULL,
  CONSTRAINT s3_message_order UNIQUE (conversation_id, ordinal)
)
;
CREATE TABLE s3_generations (
  conversation_id VARCHAR2(36) PRIMARY KEY REFERENCES s2_conversations(id) ON DELETE CASCADE,
  run_id VARCHAR2(36) NOT NULL,
  expires_at TIMESTAMP NOT NULL
)
;
UPDATE s2_control SET version = 2 WHERE id = 1
;
