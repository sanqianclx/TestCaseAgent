ALTER TABLE uploaded_files MODIFY COLUMN purpose ENUM('source','reference','config','other','test_output','test_plan') NOT NULL;
