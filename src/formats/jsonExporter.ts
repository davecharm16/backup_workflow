import { supabaseClient } from '../database/supabaseClient';
import { DatabaseMetadata, TableSchema } from '../database/exporter';
import { format } from 'date-fns';

export interface JsonExportOptions {
  includeMetadata: boolean;
  includeSchema: boolean;
  includeData: boolean;
  prettyPrint: boolean;
  includeTimestamp: boolean;
}

export interface JsonBackupStructure {
  backup: {
    metadata: {
      databaseName: string;
      generatedAt: string;
      totalTables: number;
      totalRows: number;
      exportFormat: string;
      options: JsonExportOptions;
    };
    tables: TableBackupData[];
  };
}

export interface TableBackupData {
  tableName: string;
  rowCount: number;
  estimatedSize: string;
  schema?: {
    columns: Array<{
      name: string;
      dataType: string;
      isNullable: boolean;
      defaultValue: string | null;
      isPrimaryKey: boolean;
    }>;
  };
  data?: any[];
  errors?: string[];
}

export class JsonExporter {
  private static defaultOptions: JsonExportOptions = {
    includeMetadata: true,
    includeSchema: true,
    includeData: true,
    prettyPrint: true,
    includeTimestamp: true
  };

  /**
   * Generate JSON backup from database metadata
   */
  public static async generateJsonBackup(
    metadata: DatabaseMetadata,
    options: Partial<JsonExportOptions> = {}
  ): Promise<string> {
    const config = { ...this.defaultOptions, ...options };
    
    console.log('🔧 Generating JSON backup...');
    const startTime = Date.now();
    
    const backup: JsonBackupStructure = {
      backup: {
        metadata: this.generateMetadata(metadata, config),
        tables: []
      }
    };

    // Process each table
    for (const table of metadata.tables) {
      try {
        console.log(`  📄 Processing table: ${table.tableName}`);
        
        const tableData = await this.processTable(table, config);
        backup.backup.tables.push(tableData);
        
      } catch (error) {
        console.error(`  ❌ Error processing table ${table.tableName}:`, error);
        
        // Add table with error information
        backup.backup.tables.push({
          tableName: table.tableName,
          rowCount: table.rowCount,
          estimatedSize: table.estimatedSize,
          errors: [(error as Error)?.message || String(error) || 'Unknown error']
        });
      }
    }
    
    const generateTime = Date.now() - startTime;
    console.log(`✅ JSON backup generated in ${generateTime}ms`);
    
    // Convert to JSON string
    const jsonString = config.prettyPrint 
      ? JSON.stringify(backup, null, 2)
      : JSON.stringify(backup);
    
    console.log(`📊 JSON backup size: ${Math.round(jsonString.length / 1024)} KB`);
    
    return jsonString;
  }

  /**
   * Generate backup metadata
   */
  private static generateMetadata(
    metadata: DatabaseMetadata, 
    config: JsonExportOptions
  ) {
    const metadataObj: any = {
      databaseName: metadata.databaseName,
      totalTables: metadata.totalTables,
      totalRows: metadata.totalRows,
      exportFormat: 'JSON',
      options: config
    };

    if (config.includeTimestamp) {
      metadataObj.generatedAt = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    }

    return metadataObj;
  }

  /**
   * Process individual table data
   */
  private static async processTable(
    table: TableSchema, 
    config: JsonExportOptions
  ): Promise<TableBackupData> {
    const tableData: TableBackupData = {
      tableName: table.tableName,
      rowCount: table.rowCount,
      estimatedSize: table.estimatedSize
    };

    // Add schema information if requested
    if (config.includeSchema) {
      tableData.schema = {
        columns: table.columns.map(column => ({
          name: column.columnName,
          dataType: column.dataType,
          isNullable: column.isNullable === 'YES',
          defaultValue: column.columnDefault,
          isPrimaryKey: column.isPrimaryKey || false
        }))
      };
    }

    // Add data if requested and table has rows
    if (config.includeData && table.rowCount > 0) {
      try {
        console.log(`    📥 Fetching data for ${table.tableName}...`);
        const data = await supabaseClient.getTableData(table.tableName);
        
        // Process and clean data
        if (data) {
          tableData.data = this.processTableData(data);
        }
        
      } catch (error) {
        console.error(`    ❌ Error fetching data for ${table.tableName}:`, error);
        tableData.errors = [(error as Error)?.message || String(error) || 'Failed to fetch data'];
      }
    }

    return tableData;
  }

  /**
   * Process and clean table data for JSON serialization
   */
  private static processTableData(data: any[]): any[] {
    return data.map(row => {
      const processedRow: any = {};
      
      for (const [key, value] of Object.entries(row)) {
        processedRow[key] = this.processValue(value);
      }
      
      return processedRow;
    });
  }

  /**
   * Process individual values for JSON serialization
   */
  private static processValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      // Handle nested objects/arrays
      if (Array.isArray(value)) {
        return value.map(item => this.processValue(item));
      }
      
      // Handle plain objects
      const processedObj: any = {};
      for (const [key, val] of Object.entries(value)) {
        processedObj[key] = this.processValue(val);
      }
      return processedObj;
    }

    // Return primitive values as-is
    return value;
  }

  /**
   * Generate structured table export (alternative format)
   * Exports each table as a separate key for easier access
   */
  public static async generateStructuredBackup(
    metadata: DatabaseMetadata,
    options: Partial<JsonExportOptions> = {}
  ): Promise<string> {
    const config = { ...this.defaultOptions, ...options };
    
    console.log('🔧 Generating structured JSON backup...');
    const startTime = Date.now();
    
    const structured: any = {};

    if (config.includeMetadata) {
      structured._metadata = this.generateMetadata(metadata, config);
    }

    // Process each table as a top-level key
    for (const table of metadata.tables) {
      try {
        console.log(`  📄 Processing table: ${table.tableName}`);
        
        const tableData: any = {
          _info: {
            rowCount: table.rowCount,
            estimatedSize: table.estimatedSize
          }
        };

        if (config.includeSchema) {
          tableData._schema = {
            columns: table.columns.map(column => ({
              name: column.columnName,
              dataType: column.dataType,
              isNullable: column.isNullable === 'YES',
              defaultValue: column.columnDefault,
              isPrimaryKey: column.isPrimaryKey || false
            }))
          };
        }

        if (config.includeData && table.rowCount > 0) {
          console.log(`    📥 Fetching data for ${table.tableName}...`);
          const data = await supabaseClient.getTableData(table.tableName);
          if (data) {
            tableData.data = this.processTableData(data);
          }
        }

        structured[table.tableName] = tableData;
        
      } catch (error) {
        console.error(`  ❌ Error processing table ${table.tableName}:`, error);
        structured[table.tableName] = {
          _info: {
            rowCount: table.rowCount,
            estimatedSize: table.estimatedSize
          },
          _errors: [(error as Error)?.message || String(error) || 'Unknown error']
        };
      }
    }
    
    const generateTime = Date.now() - startTime;
    console.log(`✅ Structured JSON backup generated in ${generateTime}ms`);
    
    const jsonString = config.prettyPrint 
      ? JSON.stringify(structured, null, 2)
      : JSON.stringify(structured);
    
    console.log(`📊 Structured JSON backup size: ${Math.round(jsonString.length / 1024)} KB`);
    
    return jsonString;
  }

  /**
   * Generate table-specific JSON export
   */
  public static async generateTableExport(
    tableName: string,
    options: Partial<JsonExportOptions> = {}
  ): Promise<string> {
    const config = { ...this.defaultOptions, ...options };
    
    console.log(`🔧 Generating JSON export for table: ${tableName}`);
    
    try {
      const data = await supabaseClient.getTableData(tableName);
      const processedData = data ? this.processTableData(data) : [];
      
      const tableExport = {
        table: tableName,
        exportedAt: config.includeTimestamp ? format(new Date(), 'yyyy-MM-dd HH:mm:ss') : undefined,
        rowCount: data?.length || 0,
        data: processedData
      };
      
      const jsonString = config.prettyPrint 
        ? JSON.stringify(tableExport, null, 2)
        : JSON.stringify(tableExport);
      
      console.log(`✅ Table ${tableName} exported (${data?.length || 0} rows, ${Math.round(jsonString.length / 1024)} KB)`);
      
      return jsonString;
      
    } catch (error) {
      console.error(`❌ Error exporting table ${tableName}:`, error);
      throw error;
    }
  }
}

// Export convenience functions
export const generateJsonBackup = JsonExporter.generateJsonBackup.bind(JsonExporter);
export const generateStructuredBackup = JsonExporter.generateStructuredBackup.bind(JsonExporter);
export const generateTableExport = JsonExporter.generateTableExport.bind(JsonExporter);