import { Column, Entity } from 'typeorm';
import { DeepPartial, VendureEntity } from '@vendure/core';
import { ExportFormat } from './export-report.entity';

export enum ScheduleFrequency {
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
}

@Entity()
export class ReportSchedule extends VendureEntity {
    constructor(input?: DeepPartial<ReportSchedule>) {
        super(input);
    }

    @Column()
    name: string;

    @Column({ default: true })
    enabled: boolean;

    @Column({ type: 'varchar' })
    frequency: ScheduleFrequency;

    @Column({ type: 'varchar' })
    exportFormat: ExportFormat;

    @Column('simple-array')
    recipientEmails: string[];

    @Column({ type: 'jsonb', nullable: true })
    filters: Record<string, any> | null;

    @Column({ default: false })
    includeAiInsights: boolean;

    @Column({ type: 'timestamp', nullable: true })
    lastRunAt: Date | null;
}
