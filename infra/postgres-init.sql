-- infra/postgres-init.sql
-- Creates the three logical databases on first postgres init for dev stack.
-- companyos: main OS app
-- plane: Plane CE tasks
-- litellm: LiteLLM key/spend tracking

CREATE DATABASE companyos;
CREATE DATABASE plane;
CREATE DATABASE litellm;
