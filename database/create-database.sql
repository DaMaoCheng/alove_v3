CREATE DATABASE IF NOT EXISTS aiove_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'aiove_app'@'localhost'
  IDENTIFIED BY 'replace_with_strong_production_password';
CREATE USER IF NOT EXISTS 'aiove_app'@'127.0.0.1'
  IDENTIFIED BY 'replace_with_strong_production_password';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON aiove_app.*
  TO 'aiove_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON aiove_app.*
  TO 'aiove_app'@'127.0.0.1';

FLUSH PRIVILEGES;
