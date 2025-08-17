import { supabaseClient } from './supabaseClient';
import { handleDatabaseError, shouldContinueOperation, ErrorSeverity } from '../utils/errorHandler';

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
  rowCount: number;
  estimatedSize: string;
}

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface DatabaseMetadata {
  databaseName: string;
  totalTables: number;
  totalRows: number;
  exportTimestamp: string;
  tables: TableSchema[];
}

export class DatabaseExporter {
  private client = supabaseClient;

  /**
   * Discover all tables and their metadata
   */
  public async discoverDatabase(): Promise<DatabaseMetadata> {
    console.log('🔍 Discovering database structure...');
    
    const startTime = Date.now();
    const tables = await this.client.getAllTableNames();
    
    if (tables.length === 0) {
      throw new Error('No tables found in the database');
    }

    console.log(`📋 Analyzing ${tables.length} tables...`);
    
    const tableSchemas: TableSchema[] = [];
    let totalRows = 0;

    for (const tableName of tables) {
      try {
        console.log(`🔍 Analyzing table: ${tableName}`);
        
        const schema = await this.getTableSchemaDetailed(tableName);
        const rowCount = await this.client.getTableRowCount(tableName);
        
        const tableSchema: TableSchema = {
          tableName,
          columns: schema,
          rowCount,
          estimatedSize: this.estimateTableSize(schema, rowCount)
        };
        
        tableSchemas.push(tableSchema);
        totalRows += rowCount;
        
        console.log(`  ✅ ${tableName}: ${rowCount} rows, ${schema.length} columns`);
        
      } catch (error) {
        const backupError = handleDatabaseError(error, `Analyze table: ${tableName}`);
        
        if (shouldContinueOperation(backupError)) {
          console.warn(`  ⚠️  Could not analyze table ${tableName}, continuing with limited info`);
          // Add table with basic info even if detailed analysis fails
          tableSchemas.push({
            tableName,
            columns: [],
            rowCount: 0,
            estimatedSize: 'Unknown'
          });
        } else {
          console.error(`  ❌ Critical error analyzing table ${tableName}, stopping analysis`);
          throw error;
        }
      }
    }

    const discoveryTime = Date.now() - startTime;
    console.log(`✅ Database discovery completed in ${discoveryTime}ms`);
    console.log(`📊 Total: ${tableSchemas.length} tables, ${totalRows} rows`);

    return {
      databaseName: 'gym_management_db',
      totalTables: tableSchemas.length,
      totalRows,
      exportTimestamp: new Date().toISOString(),
      tables: tableSchemas
    };
  }

  /**
   * Get detailed schema information for a table
   */
  private async getTableSchemaDetailed(tableName: string): Promise<ColumnInfo[]> {
    try {
      // Since we can't easily access information_schema, we'll use a different approach
      // Get a sample row to understand the structure
      const { data: sampleData, error } = await this.client.getClient()
        .from(tableName)
        .select('*')
        .limit(1);

      if (error && !error.message.includes('no rows')) {
        throw error;
      }

      const columns: ColumnInfo[] = [];
      
      if (sampleData && sampleData.length > 0) {
        const sampleRow = sampleData[0];
        
        // Analyze each column from the sample data
        for (const [columnName, value] of Object.entries(sampleRow)) {
          const dataType = this.inferDataType(value);
          
          columns.push({
            columnName,
            dataType,
            isNullable: value === null ? 'YES' : 'NO',
            columnDefault: null,
            isPrimaryKey: columnName === 'id' || columnName.endsWith('_id'),
            isForeignKey: columnName.endsWith('_id') && columnName !== 'id'
          });
        }
      } else {
        // No data in table, try to get structure from an empty query
        try {
          const { data, error: emptyError } = await this.client.getClient()
            .from(tableName)
            .select('*')
            .eq('id', 'non-existent-id-to-get-structure');
          
          // Even with no results, Supabase returns the column structure
          if (!emptyError) {
            // This would be empty but we can't easily get column names without data
            console.log(`  ℹ️  Table ${tableName} is empty, limited schema info available`);
          }
        } catch (structureError) {
          console.warn(`  ⚠️  Could not get structure for empty table ${tableName}`);
        }
      }

      return columns;
      
    } catch (error) {
      console.error(`Error getting schema for table ${tableName}:`, error);
      return [];
    }
  }

  /**
   * Infer data type from a sample value
   */
  private inferDataType(value: any): string {
    if (value === null || value === undefined) {
      return 'unknown';
    }
    
    if (typeof value === 'string') {
      // Check if it looks like a UUID
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return 'uuid';
      }
      // Check if it looks like a timestamp
      if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
        return 'timestamp';
      }
      // Check if it's a date
      if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return 'date';
      }
      return 'text';
    }
    
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'numeric';
    }
    
    if (typeof value === 'boolean') {
      return 'boolean';
    }
    
    if (Array.isArray(value)) {
      return 'array';
    }
    
    if (typeof value === 'object') {
      return 'jsonb';
    }
    
    return 'unknown';
  }

  /**
   * Estimate table size based on schema and row count
   */
  private estimateTableSize(columns: ColumnInfo[], rowCount: number): string {
    if (rowCount === 0) return '0 KB';
    
    let avgRowSize = 0;
    
    for (const column of columns) {
      switch (column.dataType) {
        case 'uuid':
          avgRowSize += 36;
          break;
        case 'integer':
          avgRowSize += 4;
          break;
        case 'bigint':
          avgRowSize += 8;
          break;
        case 'numeric':
          avgRowSize += 8;
          break;
        case 'boolean':
          avgRowSize += 1;
          break;
        case 'timestamp':
          avgRowSize += 8;
          break;
        case 'date':
          avgRowSize += 4;
          break;
        case 'text':
          avgRowSize += 50; // Estimate average text length
          break;
        case 'jsonb':
          avgRowSize += 100; // Estimate average JSON size
          break;
        default:
          avgRowSize += 20; // Default estimate
      }
    }
    
    const totalSizeBytes = avgRowSize * rowCount;
    
    if (totalSizeBytes < 1024) {
      return `${totalSizeBytes} B`;
    } else if (totalSizeBytes < 1024 * 1024) {
      return `${Math.round(totalSizeBytes / 1024)} KB`;
    } else {
      return `${Math.round(totalSizeBytes / (1024 * 1024))} MB`;
    }
  }

  /**
   * Export all table data
   */
  public async exportAllTableData(): Promise<Record<string, any[]>> {
    console.log('📤 Exporting all table data...');
    
    const tables = await this.client.getAllTableNames();
    const exportData: Record<string, any[]> = {};
    
    for (const tableName of tables) {
      try {
        console.log(`📥 Exporting data from table: ${tableName}`);
        const data = await this.client.getTableData(tableName);
        exportData[tableName] = data;
        
      } catch (error) {
        const backupError = handleDatabaseError(error, `Export data from table: ${tableName}`);
        
        if (shouldContinueOperation(backupError)) {
          console.warn(`  ⚠️  Failed to export data from table ${tableName}, continuing with empty data`);
          exportData[tableName] = [];
        } else {
          console.error(`  ❌ Critical error exporting table ${tableName}, stopping export`);
          throw error;
        }
      }
    }
    
    console.log('✅ All table data exported successfully');
    return exportData;
  }

  /**
   * Get export summary
   */
  public async getExportSummary(): Promise<{
    tables: string[];
    totalRows: number;
    estimatedTotalSize: string;
    exportTime: string;
  }> {
    const metadata = await this.discoverDatabase();
    
    const totalSize = metadata.tables.reduce((acc, table) => {
      const sizeNum = parseFloat(table.estimatedSize.replace(/[^\d.]/g, ''));
      const unit = table.estimatedSize.includes('MB') ? 1024 * 1024 : 
                   table.estimatedSize.includes('KB') ? 1024 : 1;
      return acc + (sizeNum * unit);
    }, 0);
    
    let formattedSize: string;
    if (totalSize < 1024) {
      formattedSize = `${Math.round(totalSize)} B`;
    } else if (totalSize < 1024 * 1024) {
      formattedSize = `${Math.round(totalSize / 1024)} KB`;
    } else {
      formattedSize = `${Math.round(totalSize / (1024 * 1024))} MB`;
    }
    
    return {
      tables: metadata.tables.map(t => t.tableName),
      totalRows: metadata.totalRows,
      estimatedTotalSize: formattedSize,
      exportTime: metadata.exportTimestamp
    };
  }
}

// Export singleton instance
export const databaseExporter = new DatabaseExporter();