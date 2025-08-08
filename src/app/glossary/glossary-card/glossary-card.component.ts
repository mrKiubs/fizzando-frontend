// src/app/glossary/glossary-card/glossary-card.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon'; // <--- AGGIUNGI QUESTO IMPORT
import { GlossaryTerm } from '../../services/glossary.service';

@Component({
  selector: 'app-glossary-card',
  standalone: true,
  imports: [CommonModule, MatIconModule], // <--- AGGIUNGI MatIconModule QUI
  templateUrl: './glossary-card.component.html',
  styleUrls: ['./glossary-card.component.scss'],
})
export class GlossaryCardComponent {
  @Input() term!: GlossaryTerm;
}
