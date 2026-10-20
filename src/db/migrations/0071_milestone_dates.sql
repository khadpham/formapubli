-- 0071: F5 - ngay ky hop dong va ngay nghiem thu cho cot moc du an (phuc vu rule engine R1-R5)
ALTER TABLE contract_milestones ADD COLUMN contract_date TEXT;
ALTER TABLE contract_milestones ADD COLUMN acceptance_date TEXT;
