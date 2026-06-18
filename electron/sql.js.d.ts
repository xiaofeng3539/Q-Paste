declare module 'sql.js' {
  interface QueryExecResult {
    columns: string[]
    values: any[][]
  }

  interface Statement {
    bind(params?: Record<string, any>): boolean
    step(): boolean
    getAsObject(): Record<string, any>
    free(): boolean
  }

  interface Database {
    run(sql: string, params?: Record<string, any>): void
    exec(sql: string): QueryExecResult[]
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>
  export default initSqlJs
  export { Database, Statement, QueryExecResult, SqlJsStatic }
}
