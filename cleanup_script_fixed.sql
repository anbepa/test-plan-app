DO LANGUAGE plpgsql $$
DECLARE
    myvar integer;
    michar varchar;
    documentNumber varchar := '901380553';
BEGIN
    -- =================================================================================================
    -- PARTE 1: LIMPIEZA POR DOCUMENTO DE IDENTIDAD
    -- =================================================================================================
    
    -- 0) PREPARE TEMP TABLES FOR IDs TO DELETE
    CREATE TEMP TABLE IF NOT EXISTS tmp_maint_to_delete AS
    SELECT tpd.maintenance_id
    FROM schsaf.tbl_payback_drafts tpd
    WHERE tpd.client_id IN (SELECT id FROM schsaf.tbl_client tc WHERE tc.document_number = documentNumber)
    UNION
    SELECT tpd.maintenance_id
    FROM schsaf.tbl_payback_drafts tpd
    WHERE tpd.payment_instruction_id IN (
        SELECT tpi.id
        FROM schsaf.tbl_payment_instruction tpi
        WHERE tpi.payment_id IN (
            SELECT tp.id
            FROM schsaf.tbl_payment tp
            WHERE tp.nit_beneficiary = documentNumber
        )
    )
    UNION
    SELECT tpd.maintenance_id
    FROM schsaf.tbl_payback_drafts tpd
    WHERE tpd.payment_instruction_id IN (
        SELECT tpi.id
        FROM schsaf.tbl_payment_instruction tpi
        WHERE tpi.obligation_id IN (
            SELECT to2.id
            FROM schsaf.tbl_obligations to2
            WHERE to2.client_id = (
                SELECT id FROM schsaf.tbl_client tc
                WHERE tc.document_number = documentNumber
            )
        )
    )
    UNION
    -- NUEVO: Mantenimientos a través de tbl_maintenance_initial_condition
    SELECT tmic.maintenance_id
    FROM schsaf.tbl_maintenance_initial_condition tmic
    WHERE tmic.obligation_id IN (
        SELECT to2.id
        FROM schsaf.tbl_obligations to2
        WHERE to2.client_id = (
            SELECT id FROM schsaf.tbl_client tc
            WHERE tc.document_number = documentNumber
        )
    );

    CREATE TEMP TABLE IF NOT EXISTS tmp_drafts_to_delete AS
    SELECT id FROM schsaf.tbl_payback_drafts WHERE client_id IN (SELECT id FROM schsaf.tbl_client WHERE document_number = documentNumber)
    UNION
    SELECT id FROM schsaf.tbl_payback_drafts WHERE payment_instruction_id IN (
        SELECT id FROM schsaf.tbl_payment_instruction WHERE payment_id IN (SELECT id FROM schsaf.tbl_payment WHERE nit_beneficiary = documentNumber)
    )
    UNION
    SELECT id FROM schsaf.tbl_payback_drafts WHERE payment_instruction_id IN (
        SELECT id FROM schsaf.tbl_payment_instruction WHERE obligation_id IN (
            SELECT id FROM schsaf.tbl_obligations WHERE client_id = (SELECT id FROM schsaf.tbl_client WHERE document_number = documentNumber)
        )
    );

    CREATE TEMP TABLE IF NOT EXISTS tmp_payments_to_delete AS
    SELECT id FROM schsaf.tbl_payment WHERE nit_beneficiary = documentNumber;

    CREATE TEMP TABLE IF NOT EXISTS tmp_ap_to_delete AS
    SELECT id FROM schsaf.tbl_account_payable WHERE client_id IN (SELECT id FROM schsaf.tbl_client WHERE document_number = documentNumber);

    -- 0.5) CLEANUP PROCESS CENTRALIZATION HISTORY
    DELETE FROM schsaf.tbl_process_centralization_history
    WHERE payback_drafts_id IN (SELECT id FROM tmp_drafts_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_process_centralization_history (por drafts)', myvar;

    DELETE FROM schsaf.tbl_process_centralization_history
    WHERE payment_id IN (SELECT id FROM tmp_payments_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_process_centralization_history (por payments)', myvar;

    DELETE FROM schsaf.tbl_process_centralization_history
    WHERE account_payable_id IN (SELECT id FROM tmp_ap_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_process_centralization_history (por AP)', myvar;

    -- 1) ACCOUNT PAYABLE
    DELETE
    FROM schsaf.tbl_account_payable tap
    WHERE id IN (SELECT id FROM tmp_ap_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_account_payable', myvar;

    -- 2) MAINTENANCE DETAIL (via temp table)
    DELETE
    FROM schsaf.tbl_maintenance_detail tmd
    WHERE id_maintenance IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_detail (via temp table)', myvar;

    -- 3) MAINTENANCE DETAIL (por relaciones a obligaciones)
    DELETE
    FROM schsaf.tbl_maintenance_detail tmd
    WHERE id_maintenance IN (
        SELECT tmr.id
        FROM schsaf.tbl_maintenance_relationships tmr
        WHERE tmr.id_relationship IN (
            SELECT to2.id
            FROM schsaf.tbl_obligations to2
            WHERE to2.client_id = (
                SELECT id FROM schsaf.tbl_client tc
                WHERE tc.document_number = documentNumber
            )
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_detail (por obligaciones)', myvar;

    -- 4) BANK DRAFTS - MAINTENANCE (via temp table)
    DELETE
    FROM schsaf.tbl_bank_drafts_maintenance tbdm
    WHERE maintenance_id IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_bank_drafts_maintenance (via temp table)', myvar;

    -- 6) RELACIONES DE MANTENIMIENTO (por obligaciones del cliente)
    DELETE
    FROM schsaf.tbl_maintenance_relationships tmr
    WHERE tmr.id_relationship IN (
        SELECT to2.id
        FROM schsaf.tbl_obligations to2
        WHERE to2.client_id = (
            SELECT id FROM schsaf.tbl_client tc
            WHERE tc.document_number = documentNumber
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_relationships (por obligaciones)', myvar;

    -- 7) RELACIONES DE MANTENIMIENTO (via temp table)
    DELETE
    FROM schsaf.tbl_maintenance_relationships tmr
    WHERE tmr.id_maintenance IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_relationships (via temp table)', myvar;

    -- 23) RELACIONES DE MANTENIMIENTO (por payback drafts)
    DELETE
    FROM schsaf.tbl_maintenance_relationships tmr
    WHERE tmr.id_relationship IN (SELECT id FROM tmp_drafts_to_delete)
    AND tmr.table_name = 'tbl_payback_drafts';
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_relationships (por drafts)', myvar;

    -- 8, 9, 9b) PAYBACK DRAFTS (using temp table)
    DELETE
    FROM schsaf.tbl_payback_drafts tpd
    WHERE id IN (SELECT id FROM tmp_drafts_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payback_drafts (via temp table)', myvar;

    -- 10) MAINTENANCE FAILURE (via temp table)
    DELETE
    FROM schsaf.tbl_maintenance_failure tmf
    WHERE tmf.maintenance_id IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_failure (via temp table)', myvar;

    -- 11) RECEIVABLES DETAILS (por cliente)
    DELETE
    FROM schsaf.tbl_receivable_payment_details trpd
    WHERE trpd.receivable_id IN (
        SELECT tr.id
        FROM schsaf.tbl_receivable tr
        WHERE tr.client_id IN (
            SELECT id FROM schsaf.tbl_client tc
            WHERE tc.document_number = documentNumber
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable_payment_details (por receivable)', myvar;

    -- *** EXTRA por FK a payment_application ***
    DELETE
    FROM schsaf.tbl_receivable_payment_details trpd
    WHERE trpd.payment_application_id IN (
        SELECT tpa.id
        FROM schsaf.tbl_payment_application tpa
        WHERE tpa.client_document = documentNumber
           OR tpa.payment_id IN (SELECT id FROM tmp_payments_to_delete)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable_payment_details (por payment_application)', myvar;

    -- 12) RECEIVABLES (por cliente)
    DELETE
    FROM schsaf.tbl_receivable tr
    WHERE tr.client_id IN (
        SELECT id
        FROM schsaf.tbl_client tc
        WHERE tc.document_number = documentNumber
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable (por cliente)', myvar;

    -- 13) RECEIVABLES (por PI de pagos del beneficiario)
    DELETE
    FROM schsaf.tbl_receivable tr
    WHERE tr.payment_instruction_id IN (
        SELECT tpi.id
        FROM schsaf.tbl_payment_instruction tpi
        WHERE tpi.payment_id IN (SELECT id FROM tmp_payments_to_delete)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable (por PI/Pago)', myvar;

    -- *** 13.5) CRÍTICO: RECEIVABLES (por mantenimientos a eliminar) ***
    -- Primero eliminar los detalles de receivables vinculados a mantenimientos
    DELETE
    FROM schsaf.tbl_receivable_payment_details trpd
    WHERE trpd.receivable_id IN (
        SELECT tr.id
        FROM schsaf.tbl_receivable tr
        WHERE tr.maintenance_id IN (SELECT maintenance_id FROM tmp_maint_to_delete)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable_payment_details (por mantenimientos a eliminar)', myvar;

    -- Luego eliminar los receivables vinculados a mantenimientos
    DELETE
    FROM schsaf.tbl_receivable tr
    WHERE tr.maintenance_id IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable (por mantenimientos a eliminar)', myvar;

    -- 14) MAINTENANCE SPECIAL (por PI ligados a obligaciones del cliente)
    DELETE
    FROM schsaf.tbl_maintenance_special tms
    WHERE tms.payment_instruction_id IN (
        SELECT tpi.id
        FROM schsaf.tbl_payment_instruction tpi
        WHERE tpi.obligation_id IN (
            SELECT to2.id
            FROM schsaf.tbl_obligations to2
            WHERE to2.client_id = (
                SELECT id FROM schsaf.tbl_client tc
                WHERE tc.document_number = documentNumber
            )
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_special (por obligaciones)', myvar;

    -- 15) ANNULMENT de maintenance_special
    DELETE
    FROM schsaf.tbl_maintenance_special_annulment tmsa
    WHERE tmsa.payment_application_id IN (
        SELECT tpa.id
        FROM schsaf.tbl_payment_application tpa
        WHERE tpa.client_document = documentNumber
           OR tpa.payment_id IN (SELECT id FROM tmp_payments_to_delete)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_special_annulment', myvar;

    -- 16) ANNULMENT de payment_application
    DELETE
    FROM schsaf.tbl_payment_application_annulment tpaa
    WHERE tpaa.id_payment_application IN (
        SELECT tpa.id
        FROM schsaf.tbl_payment_application tpa
        WHERE tpa.client_document = documentNumber
           OR tpa.payment_id IN (SELECT id FROM tmp_payments_to_delete)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payment_application_annulment', myvar;

    -- 17) payment_application_obligation
    DELETE
    FROM schsaf.tbl_payment_application_obligation pao
    WHERE pao.id_payment_application IN (
        SELECT tpa.id
        FROM schsaf.tbl_payment_application tpa
        WHERE tpa.client_document = documentNumber
           OR tpa.payment_id IN (SELECT id FROM tmp_payments_to_delete)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payment_application_obligation', myvar;

    -- 18) *** CLAVE: Romper FK en payment_instruction ***
    UPDATE schsaf.tbl_payment_instruction tpi
    SET payment_application_id = NULL
    WHERE tpi.payment_application_id IN (
        SELECT tpa.id
        FROM schsaf.tbl_payment_application tpa
        WHERE tpa.client_document = documentNumber
           OR tpa.payment_id IN (SELECT id FROM tmp_payments_to_delete)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Actualizados % en tbl_payment_instruction.payment_application_id = NULL', myvar;

    -- 19) PAYMENT APPLICATION
    DELETE
    FROM schsaf.tbl_payment_application tpa
    WHERE tpa.payment_id IN (SELECT id FROM tmp_payments_to_delete)
       OR tpa.client_document = documentNumber;
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payment_application', myvar;

    -- 20) PAYMENT INSTRUCTION (por obligación del cliente)
    DELETE
    FROM schsaf.tbl_payment_instruction tpi
    WHERE tpi.obligation_id IN (
        SELECT to2.id
        FROM schsaf.tbl_obligations to2
        WHERE to2.client_id = (
            SELECT id FROM schsaf.tbl_client tc
            WHERE tc.document_number = documentNumber
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payment_instruction (por obligaciones)', myvar;

    -- 21) PAYMENT INSTRUCTION (por pagos del beneficiario)
    DELETE
    FROM schsaf.tbl_payment_instruction tpi
    WHERE tpi.payment_id IN (SELECT id FROM tmp_payments_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payment_instruction (por pagos)', myvar;

    -- 22) RELACIONES DE MANTENIMIENTO (por pagos del beneficiario)
    DELETE
    FROM schsaf.tbl_maintenance_relationships tmr
    WHERE tmr.id_relationship IN (SELECT id FROM tmp_payments_to_delete)
    AND tmr.table_name = 'tbl_payments';
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_relationships (por pagos)', myvar;

    -- 24) PAYMENT (pagos del beneficiario)
    DELETE
    FROM schsaf.tbl_payment tp
    WHERE id IN (SELECT id FROM tmp_payments_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payment', myvar;

    -- 25) FINANCE CHARGES
    DELETE
    FROM schsaf.tbl_finance_charges tfc
    WHERE tfc.obligation_id IN (
        SELECT tob.id
        FROM schsaf.tbl_obligations tob
        WHERE tob.client_id = (
            SELECT tc.id
            FROM schsaf.tbl_client tc
            WHERE tc.document_number = documentNumber
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_finance_charges', myvar;

    -- 26) ACCOUNTING MOVEMENT DETAIL
    DELETE
    FROM schsaf.tbl_accounting_movement_detail tamd
    WHERE tamd.nit = documentNumber
      AND tamd.movement_id NOT IN (
          SELECT tam.id
          FROM schsaf.tbl_accounting_movement tam
          WHERE tam.transaction_id IN (
              SELECT tat.id
              FROM schsaf.tbl_accounting_transaction tat
              WHERE tat.process_id = 13
          )
      );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_accounting_movement_detail', myvar;

    -- 27) MAINTENANCE SPECIAL (por cliente directo)
    DELETE
    FROM schsaf.tbl_maintenance_special tms
    WHERE tms.client_id IN (
        SELECT id FROM schsaf.tbl_client tc
        WHERE tc.document_number = documentNumber
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_special (por cliente)', myvar;

    /* ======== LIMPIEZA ENRIQUECIDOS ======== */
    -- 28) ENRICHED ACCOUNTS RECEIVABLE
    DELETE
    FROM schsaf.tbl_enriched_accounts_receivable tear
    WHERE tear.document_number = documentNumber;
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_enriched_accounts_receivable', myvar;

    -- 29) ENRICHED DISTRIBUTION PAYMENT INSTRUCTION
    DELETE
    FROM schsaf.tbl_enriched_distribution_payment_instruction tedpi
    WHERE tedpi.resultant_data_id IN (
        SELECT terd.id
        FROM schsaf.tbl_enriched_resultant_data terd
        WHERE terd.enriched_payment_id IN (
            SELECT tep.id
            FROM schsaf.tbl_enriched_payment tep
            WHERE tep.document_number_payer = documentNumber
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_enriched_distribution_payment_instruction', myvar;

    -- 30) ENRICHED RESULTANT DATA
    DELETE
    FROM schsaf.tbl_enriched_resultant_data terd
    WHERE terd.enriched_payment_id IN (
        SELECT tep.id
        FROM schsaf.tbl_enriched_payment tep
        WHERE tep.document_number_payer = documentNumber
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_enriched_resultant_data', myvar;

    -- 31) ENRICHED PAYMENT
    DELETE
    FROM schsaf.tbl_enriched_payment tep
    WHERE tep.document_number_payer = documentNumber;
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_enriched_payment', myvar;

    -- 32) OBLIGATIONS_MAINTENANCE (por obligaciones del cliente)
    DELETE
    FROM schsaf.tbl_obligations_maintenance tom
    WHERE tom.obligation_id IN (
        SELECT tob.id
        FROM schsaf.tbl_obligations tob
        WHERE tob.client_id = (
            SELECT tc.id
            FROM schsaf.tbl_client tc
            WHERE tc.document_number = documentNumber
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_obligations_maintenance (por obligaciones)', myvar;

    -- *** 32.5) CRÍTICO: OBLIGATIONS_MAINTENANCE (por mantenimientos a eliminar) ***
    -- Este paso es ESENCIAL para evitar violaciones de FK al eliminar tbl_maintenance
    DELETE
    FROM schsaf.tbl_obligations_maintenance tom
    WHERE tom.maintenance_id IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_obligations_maintenance (por mantenimientos a eliminar)', myvar;

    -- 33) RATE_VALIDITY_HISTORY
    DELETE
    FROM schsaf.tbl_rate_validity_history trvh
    WHERE trvh.obligation_id IN (
        SELECT tob.id
        FROM schsaf.tbl_obligations tob
        WHERE tob.client_id = (
            SELECT tc.id
            FROM schsaf.tbl_client tc
            WHERE tc.document_number = documentNumber
        )
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_rate_validity_history', myvar;

    -- 34) MAINTENANCE_BATCH_PROCESS
    DELETE
    FROM schsaf.tbl_maintenance_batch_process tmbp
    WHERE tmbp.maintenance_id IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_batch_process', myvar;

    -- 34.5) MAINTENANCE_INITIAL_CONDITION (ANTES de eliminar tbl_maintenance)
    DELETE
    FROM schsaf.tbl_maintenance_initial_condition tmic
    WHERE tmic.maintenance_id IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_initial_condition (via temp table)', myvar;

    -- 35) MAINTENANCE (via temp table)
    DELETE
    FROM schsaf.tbl_maintenance tm
    WHERE tm.id IN (SELECT maintenance_id FROM tmp_maint_to_delete);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance (via temp table)', myvar;


    -- =================================================================================================
    -- PARTE 2: LIMPIEZA DE MANTENIMIENTOS HUÉRFANOS (Client Full Name IS NULL)
    -- =================================================================================================
    
    -- A) Crear tabla temporal para huérfanos
    CREATE TEMP TABLE IF NOT EXISTS tmp_orphan_maint_ids AS
    SELECT id 
    FROM schsaf.view_maintenance_info vmi 
    WHERE vmi.client_full_name IS NULL;
    
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Identificados % mantenimientos huérfanos (client_full_name IS NULL)', myvar;

    -- B) Eliminar registros de tbl_maintenance_relationships
    DELETE FROM schsaf.tbl_maintenance_relationships
    WHERE id_maintenance IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_relationships (huérfanos)', myvar;

    -- C) Eliminar registros de tbl_maintenance_detail
    DELETE FROM schsaf.tbl_maintenance_detail
    WHERE id_maintenance IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_detail (huérfanos)', myvar;

    -- D) Eliminar registros de tbl_maintenance_failure
    DELETE FROM schsaf.tbl_maintenance_failure
    WHERE maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_failure (huérfanos)', myvar;

    -- E) Eliminar registros de tbl_bank_drafts_maintenance
    DELETE FROM schsaf.tbl_bank_drafts_maintenance
    WHERE maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_bank_drafts_maintenance (huérfanos)', myvar;

    -- F) Eliminar registros de tbl_obligations_maintenance (huérfanos)
    DELETE FROM schsaf.tbl_obligations_maintenance
    WHERE maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_obligations_maintenance (huérfanos)', myvar;

    -- G) Eliminaciones para tbl_maintenance_initial_condition
    DELETE FROM schsaf.tbl_maintenance_initial_condition tmi
    WHERE tmi.maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_initial_condition (huérfanos)', myvar;

    -- H) Eliminaciones para tbl_maintenance_batch_process
    DELETE FROM schsaf.tbl_maintenance_batch_process tmb
    WHERE tmb.maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_batch_process (huérfanos)', myvar;

    -- I) DELETE FROM tbl_account_payable
    DELETE FROM schsaf.tbl_account_payable 
    WHERE maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_account_payable (huérfanos)', myvar;

    -- J) DELETE RECEIVABLE DATA
    -- Primero detalles
    DELETE FROM schsaf.tbl_receivable_payment_details 
    WHERE receivable_id IN (
        SELECT id FROM schsaf.tbl_receivable 
        WHERE maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids)
    );
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable_payment_details (huérfanos)', myvar;

    -- Luego cabecera receivable
    DELETE FROM schsaf.tbl_receivable
    WHERE maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_receivable (huérfanos)', myvar;

    -- K) CLEANUP DRAFTS LINKED TO ORPHAN MAINTENANCES
    -- Identify drafts linked to these maintenances
    CREATE TEMP TABLE IF NOT EXISTS tmp_orphan_drafts AS
    SELECT id FROM schsaf.tbl_payback_drafts
    WHERE maintenance_id IN (SELECT id FROM tmp_orphan_maint_ids);

    -- Clean history for these drafts
    DELETE FROM schsaf.tbl_process_centralization_history
    WHERE payback_drafts_id IN (SELECT id FROM tmp_orphan_drafts);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_process_centralization_history (huérfanos)', myvar;
    
    -- Delete drafts
    DELETE FROM schsaf.tbl_payback_drafts
    WHERE id IN (SELECT id FROM tmp_orphan_drafts);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_payback_drafts (huérfanos)', myvar;

    -- L) DELETE MAINTENANCE DEVOLUTION
    DELETE FROM schsaf.tbl_maintenance_devolution
    WHERE id_maintenance IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance_devolution (huérfanos)', myvar;

    -- M) Eliminar registros de schsaf.tbl_maintenance (FINAL)
    DELETE FROM schsaf.tbl_maintenance
    WHERE id IN (SELECT id FROM tmp_orphan_maint_ids);
    GET DIAGNOSTICS myvar = ROW_COUNT;
    RAISE NOTICE 'Eliminados % de tbl_maintenance (huérfanos)', myvar;

    -- Cleanup
    DROP TABLE IF EXISTS tmp_maint_to_delete;
    DROP TABLE IF EXISTS tmp_drafts_to_delete;
    DROP TABLE IF EXISTS tmp_payments_to_delete;
    DROP TABLE IF EXISTS tmp_ap_to_delete;
    DROP TABLE IF EXISTS tmp_orphan_maint_ids;
    DROP TABLE IF EXISTS tmp_orphan_drafts;

    michar := 'OK';
    RAISE NOTICE 'finalizado %', michar;
END
$$;
