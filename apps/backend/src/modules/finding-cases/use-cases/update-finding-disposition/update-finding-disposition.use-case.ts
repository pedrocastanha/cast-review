import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { FindingCase } from '../../finding-case.entity';
import type { FindingCaseRepository } from '../../finding-case.repository';
import type { FindingCaseEventRepository } from '../../finding-case-event.repository';
import type { FindingDisposition } from '../../finding-cases.types';
import type { UpdateFindingDispositionDto } from './update-finding-disposition.dto';

export class UpdateFindingDispositionUseCase {
  constructor(
    private readonly caseRepository: FindingCaseRepository,
    private readonly eventRepository: FindingCaseEventRepository,
  ) {}

  async execute(
    caseId: string,
    requestedBy: string,
    input: UpdateFindingDispositionDto,
  ) {
    const disposition = this.parseDisposition(input.disposition);
    const note = this.normalizeNote(disposition, input.note);

    return this.caseRepository.datasource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`finding-case|${caseId}`],
      );
      const findingCase = await this.caseRepository.findOne(
        { where: { id: caseId, requestedBy } },
        manager,
      );
      if (!findingCase) {
        throw new NotFoundException('Finding case não encontrado');
      }
      if (
        findingCase.disposition === disposition &&
        findingCase.dispositionNote === note
      ) {
        return this.toResponse(findingCase);
      }

      const previousDisposition = findingCase.disposition;
      const updatedAt = new Date();
      await this.caseRepository.update(
        findingCase.id,
        { disposition, dispositionNote: note, updatedAt },
        manager,
      );
      Object.assign(findingCase, {
        disposition,
        dispositionNote: note,
        updatedAt,
      });
      await this.eventRepository.save(
        this.eventRepository.create(
          {
            id: randomUUID(),
            caseId: findingCase.id,
            analysisId: null,
            actorId: requestedBy,
            type: 'disposition_changed',
            payload: { previousDisposition, disposition, note },
          },
          manager,
        ),
        undefined,
        manager,
      );

      return this.toResponse(findingCase);
    });
  }

  private parseDisposition(value: string): FindingDisposition {
    if (
      value !== 'unreviewed' &&
      value !== 'accepted_risk' &&
      value !== 'false_positive'
    ) {
      throw new BadRequestException('disposition inválida');
    }
    return value;
  }

  private normalizeNote(
    disposition: FindingDisposition,
    value?: string | null,
  ): string | null {
    if (disposition === 'unreviewed') return null;
    const note = typeof value === 'string' ? value.trim() : null;
    if (note !== null && (note.length < 1 || note.length > 500)) {
      throw new BadRequestException('note deve ter entre 1 e 500 caracteres');
    }
    if (disposition === 'false_positive' && !note) {
      throw new BadRequestException('note é obrigatória para false_positive');
    }
    return note;
  }

  private toResponse(findingCase: FindingCase) {
    return {
      id: findingCase.id,
      state: findingCase.state,
      disposition: findingCase.disposition,
      dispositionNote: findingCase.dispositionNote,
      updatedAt: findingCase.updatedAt.toISOString(),
    };
  }
}
