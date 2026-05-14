package mysqlutil

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

func OpenFromEnv() (*sql.DB, error) {
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		dsn = "app:app@tcp(localhost:3306)/chadchat?parseTime=true&multiStatements=true&charset=utf8mb4"
	}

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}

	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetMaxIdleConns(10)
	db.SetMaxOpenConns(25)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return db, nil
}

func ExecStatements(db *sql.DB, statements []string) error {
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("exec schema: %w", err)
		}
	}
	return nil
}

func Ping(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return db.PingContext(ctx)
}

func ColumnExists(db *sql.DB, tableName, columnName string) (bool, error) {
	var exists int
	err := db.QueryRow(
		`SELECT COUNT(*)
		 FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
		tableName, columnName,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}

func IndexExists(db *sql.DB, tableName, indexName string) (bool, error) {
	var exists int
	err := db.QueryRow(
		`SELECT COUNT(*)
		 FROM information_schema.statistics
		 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
		tableName, indexName,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}
