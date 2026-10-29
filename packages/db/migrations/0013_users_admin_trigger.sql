-- Drizzle names every column in an INSERT (DEFAULT for unset ones), so a column-level
-- INSERT grant cannot hide is_platform_admin. Restore the grant and enforce the rule with
-- a trigger instead: rows written by the app role are never platform admins on insert,
-- and the app role can never change the flag (UPDATE is already column-restricted).
GRANT INSERT ON users TO rental_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_users_no_admin_from_app() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'rental_app' THEN
    NEW.is_platform_admin := false;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS users_no_admin_from_app ON users;
--> statement-breakpoint
CREATE TRIGGER users_no_admin_from_app BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION app_users_no_admin_from_app();
