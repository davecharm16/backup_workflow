import { supabaseClient } from '../database/supabaseClient';
import { DatabaseMetadata, TableSchema } from '../database/exporter';
import { format } from 'date-fns';

export interface SqlExportOptions {
  includeSchema: boolean;
  includeData: boolean;
  includeDropStatements: boolean;
  includeComments: boolean;
  batchSize: number;
}

export class SqlExporter {
  private static defaultOptions: SqlExportOptions = {
    includeSchema: true,
    includeData: true,
    includeDropStatements: false,
    includeComments: true,
    batchSize: 1000
  };

  /**
   * Generate SQL dump from database metadata
   */
  public static async generateSqlDump(
    metadata: DatabaseMetadata,
    options: Partial<SqlExportOptions> = {}
  ): Promise<string> {
    const config = { ...this.defaultOptions, ...options };
    
    console.log('🔧 Generating SQL dump...');
    const startTime = Date.now();
    
    let sql = this.generateHeader(metadata, config);
    
    // Process each table
    for (const table of metadata.tables) {
      try {
        console.log(`  📄 Processing table: ${table.tableName}`);
        
        if (config.includeSchema) {
          sql += await this.generateTableSchema(table, config);
        }
        
        if (config.includeData && table.rowCount > 0) {
          sql += await this.generateTableData(table, config);
        }
        
      } catch (error) {
        console.error(`  ❌ Error processing table ${table.tableName}:`, error);
        sql += this.generateErrorComment(table.tableName, error);
      }
    }
    
    sql += this.generateFooter(metadata, config);
    
    const generateTime = Date.now() - startTime;
    console.log(`✅ SQL dump generated in ${generateTime}ms`);
    console.log(`📊 SQL dump size: ${Math.round(sql.length / 1024)} KB`);
    
    return sql;
  }

  /**
   * Generate SQL dump header
   */
  private static generateHeader(metadata: DatabaseMetadata, config: SqlExportOptions): string {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    
    let header = '';
    
    if (config.includeComments) {
      header += `-- =====================================================\n`;
      header += `-- Gym Management Database Backup\n`;
      header += `-- Generated: ${timestamp}\n`;
      header += `-- Database: ${metadata.databaseName}\n`;
      header += `-- Total Tables: ${metadata.totalTables}\n`;
      header += `-- Total Rows: ${metadata.totalRows}\n`;
      header += `-- Export Format: SQL Dump\n`;
      header += `-- =====================================================\n\n`;
      
      header += `-- Backup Options:\n`;
      header += `-- Include Schema: ${config.includeSchema}\n`;
      header += `-- Include Data: ${config.includeData}\n`;
      header += `-- Include Drop Statements: ${config.includeDropStatements}\n`;
      header += `-- Batch Size: ${config.batchSize}\n\n`;
    }
    
    // Set connection parameters
    header += `SET statement_timeout = 0;\n`;
    header += `SET lock_timeout = 0;\n`;
    header += `SET client_encoding = 'UTF8';\n`;
    header += `SET standard_conforming_strings = on;\n`;
    header += `SET check_function_bodies = false;\n`;
    header += `SET xmloption = content;\n`;
    header += `SET client_min_messages = warning;\n`;
    header += `SET row_security = off;\n\n`;
    
    return header;
  }

  /**
   * Generate table schema (CREATE TABLE statement)
   */
  private static async generateTableSchema(table: TableSchema, config: SqlExportOptions): Promise<string> {
    let sql = '';
    
    if (config.includeComments) {
      sql += `-- =====================================================\n`;
      sql += `-- Table: ${table.tableName}\n`;
      sql += `-- Rows: ${table.rowCount}\n`;
      sql += `-- Columns: ${table.columns.length}\n`;
      sql += `-- Estimated Size: ${table.estimatedSize}\n`;
      sql += `-- =====================================================\n\n`;
    }
    
    // Drop table if requested
    if (config.includeDropStatements) {
      sql += `DROP TABLE IF EXISTS public."${table.tableName}" CASCADE;\n\n`;
    }
    
    // Create table statement
    sql += `CREATE TABLE IF NOT EXISTS public."${table.tableName}" (\n`;
    
    if (table.columns.length > 0) {
      const columnDefinitions = table.columns.map(column => {
        let definition = `    "${column.columnName}" ${this.mapDataType(column.dataType)}`;
        
        // Add constraints
        if (column.isNullable === 'NO') {
          definition += ' NOT NULL';
        }
        
        if (column.columnDefault) {
          definition += ` DEFAULT ${column.columnDefault}`;
        }
        
        return definition;
      });
      
      sql += columnDefinitions.join(',\n');
      
      // Add primary key constraint if we can identify it
      const primaryKeyColumns = table.columns.filter(col => col.isPrimaryKey);
      if (primaryKeyColumns.length > 0) {
        const pkColumns = primaryKeyColumns.map(col => `"${col.columnName}"`).join(', ');
        sql += `,\n    PRIMARY KEY (${pkColumns})`;
      }
    } else {
      sql += `    -- Schema information not available`;
    }
    
    sql += `\n);\n\n`;
    
    // Add table comment
    if (config.includeComments) {
      sql += `COMMENT ON TABLE public."${table.tableName}" IS 'Backed up from Gym Management System on ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}';\n\n`;
    }
    
    return sql;
  }

  /**
   * Generate table data (INSERT statements)
   */
  private static async generateTableData(table: TableSchema, config: SqlExportOptions): Promise<string> {
    let sql = '';
    
    try {
      console.log(`    📥 Fetching data for ${table.tableName}...`);
      const data = await supabaseClient.getTableData(table.tableName);
      
      if (!data || data.length === 0) {
        if (config.includeComments) {
          sql += `-- No data found in table ${table.tableName}\n\n`;
        }
        return sql;
      }
      
      if (config.includeComments) {
        sql += `-- Data for table ${table.tableName} (${data.length} rows)\n`;
      }
      
      sql += `DELETE FROM public."${table.tableName}";\n`;
      
      // Process data in batches  
      const batches = this.chunkArray(data as any[], config.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        if (config.includeComments && batches.length > 1) {
          sql += `-- Batch ${i + 1} of ${batches.length}\n`;
        }
        
        if (batch) {
          sql += this.generateInsertStatement(table.tableName, batch);
        }
      }
      
      sql += '\n';
      
    } catch (error) {
      console.error(`    ❌ Error fetching data for ${table.tableName}:`, error);
      sql += `-- Error fetching data for table ${table.tableName}: ${error}\n\n`;
    }
    
    return sql;
  }

  /**
   * Generate INSERT statement for a batch of data
   */
  private static generateInsertStatement(tableName: string, data: any[]): string {
    if (data.length === 0) return '';
    
    const columns = Object.keys(data[0]);
    const columnList = columns.map(col => `"${col}"`).join(', ');
    
    let sql = `INSERT INTO public."${tableName}" (${columnList}) VALUES\n`;
    
    const valueRows = data.map(row => {
      const values = columns.map(col => this.formatValue(row[col])).join(', ');
      return `    (${values})`;
    });
    
    sql += valueRows.join(',\n');
    sql += ';\n';
    
    return sql;
  }

  /**
   * Format a value for SQL insertion
   */
  private static formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    
    if (typeof value === 'string') {
      // Escape single quotes and wrap in quotes
      return `'${value.replace(/'/g, "''")}'`;
    }
    
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    
    if (typeof value === 'number') {
      return value.toString();
    }
    
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    
    if (typeof value === 'object') {
      // Handle JSON objects
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  /**
   * Map database data types to SQL types
   */
  private static mapDataType(dataType: string): string {
    const typeMap: Record<string, string> = {
      'uuid': 'UUID',
      'text': 'TEXT',
      'integer': 'INTEGER',
      'bigint': 'BIGINT',
      'numeric': 'NUMERIC',
      'boolean': 'BOOLEAN',
      'timestamp': 'TIMESTAMP WITH TIME ZONE',
      'date': 'DATE',
      'jsonb': 'JSONB',
      'array': 'TEXT[]',
      'unknown': 'TEXT'
    };
    
    return typeMap[dataType] || 'TEXT';
  }

  /**
   * Generate error comment for failed tables
   */
  private static generateErrorComment(tableName: string, error: any): string {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    return `-- ERROR: Failed to process table ${tableName}: ${errorMessage}\n\n`;
  }

  /**
   * Generate SQL dump footer
   */
  private static generateFooter(metadata: DatabaseMetadata, config: SqlExportOptions): string {
    let footer = '';
    
    if (config.includeComments) {
      footer += `-- =====================================================\n`;
      footer += `-- End of Gym Management Database Backup\n`;
      footer += `-- Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}\n`;
      footer += `-- Total Tables Processed: ${metadata.totalTables}\n`;
      footer += `-- Total Rows Exported: ${metadata.totalRows}\n`;
      footer += `-- =====================================================\n`;
    }
    
    return footer;
  }

  /**
   * Split array into chunks
   */
  private static chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// Export convenience function
export const generateSqlDump = SqlExporter.generateSqlDump.bind(SqlExporter);