-- Removes the temporary diagnostic function used to confirm create_sale()
-- was the only function with duplicate overloads on this database.
DROP FUNCTION IF EXISTS public._diag_duplicate_functions();
