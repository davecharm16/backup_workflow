import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/environment';
import { retryDatabaseOperation, withTimeout } from '../utils/retryLogic';
import fetch from 'node-fetch';

export class SupabaseBackupClient {
  private client: SupabaseClient;
  private static instance: SupabaseBackupClient;

  private constructor() {
    this.client = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        db: {
          schema: 'public',
        },
      }
    );
  }

  public static getInstance(): SupabaseBackupClient {
    if (!SupabaseBackupClient.instance) {
      SupabaseBackupClient.instance = new SupabaseBackupClient();
    }
    return SupabaseBackupClient.instance;
  }

  public getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Test database connection with retry logic
   */
  public async testConnection(): Promise<boolean> {
    try {
      await retryDatabaseOperation(async () => {
        const result = await withTimeout(
          async () => {
            const { data, error } = await this.client.from('users').select('id').limit(1);
            return { data, error };
          },
          10000, // 10 second timeout
          'Database connection test'
        );

        if (result.error && !result.error.message.includes('permission denied') && !result.error.message.includes('relation') && !result.error.message.includes('does not exist')) {
          throw new Error(`Database connection failed: ${result.error.message}`);
        }

        return true;
      }, 'Database Connection Test');

      console.log('✅ Database connection successful');
      return true;
    } catch (error) {
      console.error('Database connection test failed after retries:', error);
      return false;
    }
  }

  /**
   * Get all table names from the public schema using comprehensive discovery
   */
  public async getAllTableNames(): Promise<string[]> {
    try {
      // First try the RPC method if available
      const { data, error } = await this.client.rpc('get_table_names');

      if (!error && data && data.length > 0) {
        console.log(`📋 Found ${data.length} tables via RPC:`, data);
        return data;
      }

      console.log('🔍 Using comprehensive table discovery method...');
      
      // Try PostgREST OpenAPI endpoint to discover all tables
      try {
        const supabaseUrl = config.supabase.url;
        const apiKey = config.supabase.serviceRoleKey;
        if (supabaseUrl) {
          const openApiUrl = `${supabaseUrl}/rest/v1/`;
          const response = await fetch(openApiUrl, {
            headers: {
              'apikey': apiKey,
              'Accept': 'application/openapi+json'
            }
          });
          
          if (response.ok) {
            const openApiSpec: any = await response.json();
            if (openApiSpec?.paths) {
              const tableNames = Object.keys(openApiSpec.paths)
                .filter(path => path.startsWith('/') && !path.includes('{'))
                .map(path => path.substring(1)) // Remove leading slash
                .filter(name => 
                  name.length > 0 && 
                  !name.includes('/') && 
                  !name.startsWith('rpc/')
                );
              
              if (tableNames.length > 0) {
                console.log(`📋 Found ${tableNames.length} tables via OpenAPI:`, tableNames);
                console.log('✅ OpenAPI discovery successful - using real database tables');
                return tableNames;
              } else {
                console.log('⚠️  OpenAPI returned empty table list');
              }
            }
          }
        }
      } catch (openApiError) {
        console.log('OpenAPI discovery failed:', openApiError);
      }

      // Fallback: Enhanced discovery using manual schema reference
      console.log('🔍 Using enhanced method to discover all tables...');
      
      // Table names from manual_schema_reference/schema_reference.sql
      // These are the actual tables in your gym database schema
      const potentialTables = [
        // Core tables from manual schema reference
        'admins',
        'enrollments', 
        'instructors',
        'payments',
        'student_checkins',
        'students',
        'subscription_fees',
        'subscription_types',
        'training_fees',
        'trainings',
        'users',
        
        // Views and computed tables discovered via OpenAPI
        'student_with_subscription_details'
      ];
      
      const existingTables: string[] = [];
      
      console.log('🔍 Discovering tables systematically...');
      
      for (const tableName of potentialTables) {
        try {
          // Check if table exists by querying its structure (0 rows)
          const { error: tableError } = await this.client
            .from(tableName)
            .select('*')
            .limit(0);
          
          if (!tableError) {
            existingTables.push(tableName);
          }
        } catch {
          // Table doesn't exist or no access - that's expected for most
        }
      }
      
      console.log(`📋 Found ${existingTables.length} existing tables via manual discovery:`, existingTables);
      
      // Return only existing tables (but they may have 0 rows)
      // This ensures we backup all tables that exist, even if they're empty
      if (existingTables.length === 0) {
        console.log('⚠️  No tables found via manual discovery, using fallback list');
        return ['users', 'students', 'payments', 'trainings', 'instructors'];
      }
      
      console.log('✅ Manual discovery successful - using discovered tables');
      return existingTables;

    } catch (error) {
      console.error('Error discovering tables:', error);
      // Final fallback to the original minimal set
      return ['users', 'students', 'payments', 'trainings', 'instructors'];
    }
  }

  /**
   * Get table schema information
   */
  public async getTableSchema(tableName: string): Promise<any[]> {
    try {
      const { data, error } = await this.client
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_schema', 'public')
        .eq('table_name', tableName)
        .order('ordinal_position');

      if (error) {
        throw new Error(`Failed to get schema for table ${tableName}: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error(`Error getting schema for table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Get all data from a table with retry logic
   */
  public async getTableData(tableName: string): Promise<any[]> {
    return await retryDatabaseOperation(async () => {
      const result = await withTimeout(
        async () => {
          const { data, error } = await this.client.from(tableName).select('*');
          return { data, error };
        },
        30000, // 30 second timeout for data retrieval
        `Get data from table ${tableName}`
      );

      if (result.error) {
        throw new Error(`Failed to get data from table ${tableName}: ${result.error.message}`);
      }

      console.log(`📊 Table ${tableName}: ${result.data?.length || 0} rows`);
      return result.data || [];
    }, `Get Table Data: ${tableName}`);
  }

  /**
   * Get table row count with retry logic
   */
  public async getTableRowCount(tableName: string): Promise<number> {
    return await retryDatabaseOperation(async () => {
      const result = await withTimeout(
        async () => {
          const { count, error } = await this.client
            .from(tableName)
            .select('*', { count: 'exact', head: true });
          return { count, error };
        },
        15000, // 15 second timeout for counting
        `Count rows in table ${tableName}`
      );

      if (result.error) {
        throw new Error(`Failed to count rows in table ${tableName}: ${result.error.message}`);
      }

      return result.count || 0;
    }, `Get Row Count: ${tableName}`);
  }

  /**
   * Execute raw SQL query (for advanced operations)
   */
  public async executeQuery(query: string): Promise<any> {
    try {
      const { data, error } = await this.client.rpc('exec_sql', { sql: query });

      if (error) {
        throw new Error(`SQL query failed: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Error executing SQL query:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const supabaseClient = SupabaseBackupClient.getInstance();