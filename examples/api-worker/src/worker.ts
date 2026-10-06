import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

// No HTTP server: an application context keeps the worker polling until the process is stopped.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // SIGTERM drains in-flight activities before exit
}
bootstrap();
