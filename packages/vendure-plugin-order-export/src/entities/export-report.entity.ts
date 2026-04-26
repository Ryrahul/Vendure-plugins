import { Column, Entity } from 'typeorm';
import { DeepPartial, VendureEntity } from '@vendure/core';

export enum ExportFormat {
    CSV = 'CSV',
    EXCEL = 'EXCEL',
    PDF = 'PDF',
}

export enum ExportStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

@Entity()
export class ExportReport extends VendureEntity {
    constructor(input?: DeepPartial<ExportReport>) {
        super(input);
    }

    @Column({ type: 'varchar' })
    type: ExportFormat;

    @Column({ type: 'varchar', default: ExportStatus.PENDING })
    status: ExportStatus;

    @Column()
    fileName: string;

    @Column({ type: 'bytea', nullable: true })
    fileData: Buffer | null;

    @Column({ type: 'jsonb', nullable: true })
    filters: Record<string, any> | null;

    @Column({ default: 0 })
    orderCount: number;

    @Column({ type: 'text', nullable: true })
    aiInsight: string | null;

    @Column({ type: 'text', nullable: true })
    error: string | null;
}
