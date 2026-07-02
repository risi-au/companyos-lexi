-- infra/postgres-init.sql
-- Creates the three logical databases on first postgres init for dev stack.
-- companyos: main OS app
-- plane: Plane CE tasks
-- litellm: LiteLLM key/spend tracking

CREATE DATABASE companyos;
CREATE DATABASE plane;
CREATE DATABASE litellm;

-- Ensure the dev user (POSTGRES_USER) owns/ can use the DBs (init runs as superuser)
GRANT ALL PRIVILEGES ON DATABASE companyos TO companyos;
GRANT ALL PRIVILEGES ON DATABASE plane TO companyos;
GRANT ALL PRIVILEGES ON DATABASE litellm TO companyos;
