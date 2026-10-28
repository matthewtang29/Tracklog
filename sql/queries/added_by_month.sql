-- Songs added to the library per month, last 24 months
-- :export_date is the date the Library.xml file was exported
SELECT STRFTIME('%Y-%m', date_added) AS month, COUNT(*) AS added
FROM v_tracks
WHERE date_added >= DATE(:export_date, 'start of month', '-23 months')
GROUP BY month
ORDER BY month;
