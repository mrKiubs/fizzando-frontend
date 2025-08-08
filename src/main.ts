// ✅ Usa direttamente la configurazione da app.config.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config'; // importa la tua config!

bootstrapApplication(AppComponent, appConfig);
