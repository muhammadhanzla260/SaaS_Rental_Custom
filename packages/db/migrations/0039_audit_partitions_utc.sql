-- Audit partitions (QA B-27): month bounds in UTC, whatever the session's time zone, and a month
-- whose rows already landed in audit_log_default (the worker was down at month end) gets its
-- partition anyway: the rows move into it instead of the creation failing every night.
CREATE OR REPLACE FUNCTION app_ensure_audit_partition(p_month date DEFAULT (date_trunc('month', now()) + interval '1 month')::date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  start_d date := make_date(extract(year from p_month)::int, extract(month from p_month)::int, 1);
  lo timestamptz := start_d::timestamp AT TIME ZONE 'UTC';
  hi timestamptz := (start_d + interval '1 month')::timestamp AT TIME ZONE 'UTC';
  part text := format('audit_log_%s', to_char(start_d, 'YYYY_MM'));
BEGIN
  IF to_regclass(part) IS NOT NULL THEN RETURN part; END IF;
  IF EXISTS (SELECT 1 FROM audit_log_default WHERE at >= lo AND at < hi) THEN
    EXECUTE format('CREATE TABLE %I (LIKE audit_log INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', part);
    EXECUTE format('INSERT INTO %I SELECT * FROM audit_log_default WHERE at >= %L AND at < %L', part, lo, hi);
    DELETE FROM audit_log_default WHERE at >= lo AND at < hi;
    EXECUTE format('ALTER TABLE audit_log ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)', part, lo, hi);
  ELSE
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)', part, lo, hi);
  END IF;
  RETURN part;
END $$;
