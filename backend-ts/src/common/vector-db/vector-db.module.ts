/**
 * 向量数据库模块
 * 
 * 提供 VectorDbService 的依赖注入
 */

import { Module, Global } from '@nestjs/common';
import { VectorDbService } from './vector-db.service';
import { SqliteVectorDB } from './implementations/sqlite-vector-db';

@Global() // 全局模块，任何地方都可以注入
@Module({
  providers: [
    VectorDbService,
    {
      provide: 'VECTOR_DB',
      useClass: SqliteVectorDB,
    },
  ],
  exports: [VectorDbService, 'VECTOR_DB'], // 导出 VECTOR_DB token
})
export class VectorDbModule {}
