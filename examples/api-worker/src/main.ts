import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // lets the Temporal connection close cleanly
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
