import { supabaseClient } from '../database/supabaseClient';
import { DatabaseMetadata, TableSchema } from '../database/exporter';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

export interface ExcelExportOptions {
  includeMetadata: boolean;
  includeSchema: boolean;
  includeData: boolean;
  maxRowsPerSheet: number;
  createSummarySheet: boolean;
  dateFormat: string;
  numberFormat: string;
}

export interface ExcelSheetData {
  sheetName: string;
  data: any[][];
  columnWidths?: number[];
  headerStyle?: any;
}

export class ExcelExporter {
  private static defaultOptions: ExcelExportOptions = {
    includeMetadata: true,
    includeSchema: true,
    includeData: true,
    maxRowsPerSheet: 100000,
    createSummarySheet: true,
    dateFormat: 'yyyy-mm-dd hh:mm:ss',
    numberFormat: '#,##0.00'
  };

  /**
   * Generate Excel workbook from database metadata and table data
   */
  public static async generateExcelBackup(
    metadata: DatabaseMetadata,
    tableData: Record<string, any[]>,
    options: Partial<ExcelExportOptions> = {}
  ): Promise<Buffer> {
    const config = { ...this.defaultOptions, ...options };
    
    console.log('🔧 Generating Excel backup...');
    const startTime = Date.now();
    
    const workbook = XLSX.utils.book_new();
    const existingSheetNames = new Set<string>();
    
    // Create summary sheet if requested
    if (config.createSummarySheet) {
      const summarySheet = this.createSummarySheet(metadata, config);
      const summaryName = this.sanitizeSheetName(summarySheet.name, existingSheetNames);
      XLSX.utils.book_append_sheet(workbook, summarySheet.sheet, summaryName);
    }

    // Process each table
    for (const table of metadata.tables) {
      try {
        console.log(`  📄 Processing table: ${table.tableName}`);
        
        const data = tableData[table.tableName] || [];
        await this.addTableToWorkbook(workbook, table, data, config, existingSheetNames);
        
      } catch (error) {
        console.error(`  ❌ Error processing table ${table.tableName}:`, error);
        
        // Add error sheet for failed table
        const errorSheet = this.createErrorSheet(table.tableName, error);
        const errorSheetName = this.sanitizeSheetName(errorSheet.name, existingSheetNames);
        XLSX.utils.book_append_sheet(workbook, errorSheet.sheet, errorSheetName);
      }
    }
    
    const generateTime = Date.now() - startTime;
    console.log(`✅ Excel backup generated in ${generateTime}ms`);
    
    // Convert workbook to buffer
    const buffer = XLSX.write(workbook, { 
      type: 'buffer', 
      bookType: 'xlsx',
      compression: true
    });
    
    console.log(`📊 Excel backup size: ${Math.round(buffer.length / 1024)} KB`);
    
    return buffer;
  }

  /**
   * Create summary sheet with database overview
   */
  private static createSummarySheet(
    metadata: DatabaseMetadata, 
    config: ExcelExportOptions
  ): { sheet: XLSX.WorkSheet; name: string } {
    const summaryData = [
      ['Database Backup Summary'],
      [''],
      ['Generated At', format(new Date(), 'yyyy-MM-dd HH:mm:ss')],
      ['Database Name', metadata.databaseName],
      ['Total Tables', metadata.totalTables],
      ['Total Rows', metadata.totalRows],
      ['Export Format', 'Excel (XLSX)'],
      [''],
      ['Export Options'],
      ['Include Metadata', config.includeMetadata ? 'Yes' : 'No'],
      ['Include Schema', config.includeSchema ? 'Yes' : 'No'],
      ['Include Data', config.includeData ? 'Yes' : 'No'],
      ['Max Rows Per Sheet', config.maxRowsPerSheet],
      [''],
      ['Table Summary'],
      ['Table Name', 'Row Count', 'Estimated Size', 'Columns']
    ];

    // Add table information
    for (const table of metadata.tables) {
      summaryData.push([
        table.tableName,
        table.rowCount,
        table.estimatedSize,
        table.columns.length
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(summaryData);
    
    // Set column widths
    worksheet['!cols'] = [
      { width: 20 },
      { width: 15 },
      { width: 15 },
      { width: 10 }
    ];

    // Style the header
    const headerCell = worksheet['A1'];
    if (headerCell) {
      headerCell.s = {
        font: { bold: true, size: 14 },
        alignment: { horizontal: 'center' }
      };
    }

    return { sheet: worksheet, name: 'Summary' };
  }

  /**
   * Add table data to workbook
   */
  private static async addTableToWorkbook(
    workbook: XLSX.WorkBook,
    table: TableSchema,
    data: any[],
    config: ExcelExportOptions,
    existingSheetNames: Set<string>
  ): Promise<void> {
    // Create schema sheet if requested
    if (config.includeSchema) {
      const schemaSheet = this.createSchemaSheet(table);
      const schemaSheetName = this.sanitizeSheetName(`${table.tableName}_Schema`, existingSheetNames);
      XLSX.utils.book_append_sheet(workbook, schemaSheet.sheet, schemaSheetName);
    }

    // Create data sheet if requested and table has data
    if (config.includeData && data && data.length > 0) {
      try {
        console.log(`    📊 Adding data for ${table.tableName} (${data.length} rows)...`);

        // Split data into multiple sheets if it exceeds max rows
        const dataChunks = this.chunkArray(data, config.maxRowsPerSheet);
        
        for (let i = 0; i < dataChunks.length; i++) {
          const chunk = dataChunks[i];
          if (chunk) {
            const dataSheet = this.createDataSheet(table.tableName, chunk, config);
            
            const sheetName = dataChunks.length > 1
              ? this.sanitizeSheetName(`${table.tableName}_${i + 1}`, existingSheetNames)
              : this.sanitizeSheetName(table.tableName, existingSheetNames);
            
            XLSX.utils.book_append_sheet(workbook, dataSheet.sheet, sheetName);
          }
        }
        
      } catch (error) {
        console.error(`    ❌ Error processing data for ${table.tableName}:`, error);
        const errorSheet = this.createErrorSheet(table.tableName, error);
        const errorSheetName = this.sanitizeSheetName(errorSheet.name, existingSheetNames);
        XLSX.utils.book_append_sheet(workbook, errorSheet.sheet, errorSheetName);
      }
    } else if (config.includeData) {
      console.log(`    ℹ️  No data provided for ${table.tableName}`);
    }
  }

  /**
   * Create schema information sheet
   */
  private static createSchemaSheet(
    table: TableSchema
  ): { sheet: XLSX.WorkSheet; name: string } {
    const schemaData = [
      ['Column Schema - ' + table.tableName],
      [''],
      ['Column Name', 'Data Type', 'Nullable', 'Default Value', 'Primary Key']
    ];

    // Add column information
    for (const column of table.columns) {
      schemaData.push([
        column.columnName,
        column.dataType,
        column.isNullable === 'YES' ? 'Yes' : 'No',
        column.columnDefault || '',
        column.isPrimaryKey ? 'Yes' : 'No'
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(schemaData);
    
    // Set column widths
    worksheet['!cols'] = [
      { width: 20 },
      { width: 15 },
      { width: 10 },
      { width: 20 },
      { width: 12 }
    ];

    return { sheet: worksheet, name: `${table.tableName}_Schema` };
  }

  /**
   * Create data sheet for table
   */
  private static createDataSheet(
    tableName: string,
    data: any[],
    config: ExcelExportOptions
  ): { sheet: XLSX.WorkSheet; name: string } {
    if (data.length === 0) {
      const emptyData = [['No data available for table: ' + tableName]];
      const worksheet = XLSX.utils.aoa_to_sheet(emptyData);
      return { sheet: worksheet, name: tableName };
    }

    // Get column names from first row
    const columns = Object.keys(data[0]);
    
    // Prepare data array with headers
    const sheetData = [columns];
    
    // Add data rows
    for (const row of data) {
      const rowData = columns.map(col => this.formatCellValue(row[col], config));
      sheetData.push(rowData);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    
    // Auto-size columns
    const columnWidths = columns.map(col => {
      const maxLength = Math.max(
        col.length,
        ...data.slice(0, 100).map(row => {
          const value = this.formatCellValue(row[col], config);
          return String(value).length;
        })
      );
      return { width: Math.min(Math.max(maxLength + 2, 8), 50) };
    });
    
    worksheet['!cols'] = columnWidths;

    // Style header row
    for (let i = 0; i < columns.length; i++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
      if (worksheet[cellRef]) {
        worksheet[cellRef].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: 'E7E6E6' } }
        };
      }
    }

    return { sheet: worksheet, name: tableName };
  }

  /**
   * Create error sheet for failed table processing
   */
  private static createErrorSheet(
    tableName: string,
    error: any
  ): { sheet: XLSX.WorkSheet; name: string } {
    const errorData = [
      [`Error Processing Table: ${tableName}`],
      [''],
      ['Error Message', error?.message || error?.toString() || 'Unknown error'],
      ['Timestamp', format(new Date(), 'yyyy-MM-dd HH:mm:ss')],
      [''],
      ['Troubleshooting Steps'],
      ['1. Check database connection'],
      ['2. Verify table permissions'],
      ['3. Check table exists'],
      ['4. Review error logs']
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(errorData);
    
    worksheet['!cols'] = [{ width: 30 }, { width: 50 }];

    return { sheet: worksheet, name: `Error_${tableName}` };
  }

  /**
   * Format cell value for Excel
   */
  private static formatCellValue(value: any, config: ExcelExportOptions): any {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  /**
   * Sanitize sheet name for Excel compatibility
   */
  private static sanitizeSheetName(name: string, existingNames: Set<string> = new Set()): string {
    // Excel sheet names cannot be longer than 31 characters
    // and cannot contain: \ / ? * [ ]
    let sanitized = name
      .replace(/[\\\/\?\*\[\]]/g, '_')
      .substring(0, 31);
    
    // Ensure the name is not empty
    if (!sanitized) {
      sanitized = 'Sheet1';
    }
    
    // Handle duplicates by adding a number suffix
    let finalName = sanitized;
    let counter = 1;
    while (existingNames.has(finalName)) {
      const suffix = `_${counter}`;
      const maxLength = 31 - suffix.length;
      finalName = sanitized.substring(0, maxLength) + suffix;
      counter++;
    }
    
    existingNames.add(finalName);
    return finalName;
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

  /**
   * Generate single-sheet Excel export for a specific table
   */
  public static async generateTableExcel(
    tableName: string,
    options: Partial<ExcelExportOptions> = {}
  ): Promise<Buffer> {
    const config = { ...this.defaultOptions, ...options };
    
    console.log(`🔧 Generating Excel export for table: ${tableName}`);
    
    try {
      const data = await supabaseClient.getTableData(tableName);
      
      const workbook = XLSX.utils.book_new();
      const dataSheet = this.createDataSheet(tableName, data || [], config);
      
      XLSX.utils.book_append_sheet(workbook, dataSheet.sheet, 'Data');
      
      // Add metadata sheet
      const metadataData = [
        ['Table Export Information'],
        [''],
        ['Table Name', tableName],
        ['Exported At', format(new Date(), 'yyyy-MM-dd HH:mm:ss')],
        ['Row Count', data?.length || 0],
        ['Export Format', 'Excel (XLSX)']
      ];
      
      const metadataSheet = XLSX.utils.aoa_to_sheet(metadataData);
      XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Info');
      
      const buffer = XLSX.write(workbook, { 
        type: 'buffer', 
        bookType: 'xlsx',
        compression: true
      });
      
      console.log(`✅ Table ${tableName} exported to Excel (${data?.length || 0} rows, ${Math.round(buffer.length / 1024)} KB)`);
      
      return buffer;
      
    } catch (error) {
      console.error(`❌ Error exporting table ${tableName} to Excel:`, error);
      throw error;
    }
  }
}

// Export convenience functions
export const generateExcelBackup = ExcelExporter.generateExcelBackup.bind(ExcelExporter);
export const generateTableExcel = ExcelExporter.generateTableExcel.bind(ExcelExporter);