-- The app may create logins (sign-up, invitations) but can never create a platform admin:
-- is_platform_admin is left out of its INSERT grant, so it always gets the default (false).
REVOKE INSERT ON users FROM rental_app;
--> statement-breakpoint
GRANT INSERT (id, name, email, email_verified, image, created_at, updated_at) ON users TO rental_app;
