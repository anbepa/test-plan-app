const fs = require('fs');
const path = './src/app/services/export/export.service.ts';
let code = fs.readFileSync(path, 'utf8');

// Add imports if not present
if (!code.includes("import jsPDF")) {
    const importRegex = /import\s+{[^}]+}\s+from\s+'docx';/;
    code = code.replace(importRegex, (match) => {
        return match + "\nimport jsPDF from 'jspdf';\nimport autoTable from 'jspdf-autotable';";
    });
}

// Add PDF export methods at the end of the class
const pdfMethods = `

    /**
     * Exporta la ejecución actual a PDF, imitando el diseño de DOCX.
     */
    async exportExecutionToPDF(execution: any, activeTestCaseIndex: number = 0, onProgress?: (current: number, total: number) => void): Promise<void> {
        if (!execution || !execution.testCases) return;

        const testCase = execution.testCases[activeTestCaseIndex];
        if (!testCase) return;

        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const margin = 40;
        
        // Portada o Encabezado
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(\`Ejecución - \${execution.huTitle}\`, margin, margin);
        
        doc.setFontSize(12);
        doc.text(\`Escenario: \${testCase.title}\`, margin, margin + 25);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(\`Precondiciones: \${testCase.preconditions || 'Ninguna'}\`, margin, margin + 45);
        
        // Hidratar evidencias antes de construir tabla
        const allStepEvidences = testCase.steps.flatMap((s: any) => s.evidences || []);
        if (allStepEvidences.length > 0) {
            await this.storageService.hydrateStepEvidence(allStepEvidences);
        }

        const tableBody = [];
        const imagesToDraw: any[] = []; // { x, y, w, h, data }
        
        let rowCounter = 0;

        for (let i = 0; i < testCase.steps.length; i++) {
            const step = testCase.steps[i];
            const stepNumber = step.numero_paso ?? (i + 1);
            const stepAction = step.accion?.trim() || \`Paso \${stepNumber}\`;
            
            const cols = Math.max(1, Number(step.evidenceColumns) || 1);
            const rowsConfig = Math.max(1, Number(step.evidenceRows) || 1);
            
            const hydratedEvidences = (step.evidences || []).map((ev: any) => {
                const cached = this.storageService.getCachedImage(ev.id);
                return cached ? { ...ev, base64Data: cached.base64Data } : ev;
            });

            // En autotable no es facil hacer grids complejos en una celda de imagen dinamicamente, 
            // así que dibujaremos las imagenes manualmente en el hook didDrawCell.
            // Necesitamos guardar un placeholder en la tabla para que autotable reserve el espacio.
            
            // Calculamos altura de fila requerida segun evidencias
            let reqRows = Math.ceil(hydratedEvidences.length / cols);
            if(reqRows === 0) reqRows = 1;
            const minHeight = reqRows * 150; // 150pt por cada fila de imagenes

            tableBody.push([
                { content: \`\${stepNumber}. \${stepAction}\`, styles: { minCellHeight: minHeight } },
                { content: hydratedEvidences.length === 0 ? this.EVIDENCE_PLACEHOLDER : '', styles: { minCellHeight: minHeight } }
            ]);

            // Guardamos referencias para dibujar despues
            imagesToDraw.push({ rowIndex: rowCounter, evidences: hydratedEvidences, cols, rowsConfig });
            rowCounter++;
            
            onProgress?.(i + 1, testCase.steps.length);
        }

        autoTable(doc, {
            startY: margin + 70,
            head: [['Paso a paso', 'Evidencias']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 116, 181], textColor: 255, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 150 },
                1: { cellWidth: 'auto' }
            },
            didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 1) {
                    const rowInfo = imagesToDraw.find(img => img.rowIndex === data.row.index);
                    if (rowInfo && rowInfo.evidences.length > 0) {
                        const cellWidth = data.cell.width;
                        const cellHeight = data.cell.height;
                        const pad = 5;
                        
                        const eCols = rowInfo.cols;
                        const eRows = Math.ceil(rowInfo.evidences.length / eCols);
                        
                        const imgW = (cellWidth - (pad * (eCols + 1))) / eCols;
                        const imgH = (cellHeight - (pad * (eRows + 1))) / eRows;
                        
                        let eIdx = 0;
                        for(let r=0; r<eRows; r++){
                            for(let c=0; c<eCols; c++){
                                if(eIdx < rowInfo.evidences.length){
                                    const ev = rowInfo.evidences[eIdx];
                                    if(ev.base64Data){
                                        try {
                                            const format = ev.base64Data.match(/data:image\\/([a-zA-Z]+);/)?.[1] || 'PNG';
                                            const x = data.cell.x + pad + (c * (imgW + pad));
                                            const y = data.cell.y + pad + (r * (imgH + pad));
                                            doc.addImage(ev.base64Data, format, x, y, imgW, imgH);
                                            doc.setDrawColor(0);
                                            doc.rect(x, y, imgW, imgH);
                                        }catch(err){}
                                    }
                                }
                                eIdx++;
                            }
                        }
                    }
                }
            }
        });

        const filename = this.escapeFilename(\`Ejecución - \${execution.huTitle}.pdf\`);
        doc.save(filename);
    }

    /**
     * Exporta reportes de análisis de evidencias a PDF.
     */
    async exportEvidenceAnalysisToPDF(
        reports: any[],
        huNumber: string,
        huTitle?: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        if (!reports || reports.length === 0) throw new Error('No hay reportes para exportar');

        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const margin = 40;
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(\`Reporte de Evidencias - HU: \${huNumber}\${huTitle ? ' | ' + huTitle : ''}\`, margin, margin);
        
        const summaryBody = reports.map((r, i) => [
            (i + 1).toString(),
            r.nombre_del_escenario || \`Escenario \${i + 1}\`
        ]);

        autoTable(doc, {
            startY: margin + 30,
            head: [['N°', 'Escenario de Prueba']],
            body: summaryBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 116, 181], textColor: 255 }
        });

        for (let i = 0; i < reports.length; i++) {
            const report = reports[i];
            const scenarioNumber = i + 1;
            const scenarioTitle = report.nombre_del_escenario?.trim()
                ? \`\${scenarioNumber}. \${report.nombre_del_escenario.trim()}\`
                : \`\${scenarioNumber}. Escenario \${scenarioNumber}\`;

            doc.addPage();
            doc.setFontSize(14);
            doc.text(scenarioTitle, margin, margin);

            const steps = report.test_scenario_steps || [];
            const tableBody = [];
            const imagesToDraw: any[] = [];
            let rowCounter = 0;

            for (let j = 0; j < steps.length; j++) {
                const step = steps[j];
                const stepAction = step.descripcion_accion_observada || \`Paso \${step.numero_paso}\`;
                
                let stepImages = report.report_images?.filter((img: any) => img.step_id === step.id) || [];
                if (stepImages.length === 0 && step.imagen_referencia) {
                    const match = step.imagen_referencia.match(/\\d+/);
                    if (match) {
                        const order = parseInt(match[0], 10);
                        const fallbackImg = report.report_images?.find((img: any) => img.image_order === order);
                        if (fallbackImg) stepImages = [fallbackImg];
                    }
                }

                // pre-fetch images to base64 for PDF
                const loadedImages = [];
                for(const img of stepImages){
                    if(img.image_url){
                        const res = await this.fetchImageAsUint8Array(img.image_url);
                        if(res){
                            // convert Uint8Array back to base64
                            const binary = Array.from(res.bytes).map(b => String.fromCharCode(b)).join('');
                            const b64 = window.btoa(binary);
                            loadedImages.push({
                                base64Data: \`data:image/\${res.type};base64,\${b64}\`,
                                type: res.type
                            });
                        }
                    }
                }

                const minHeight = loadedImages.length > 0 ? 250 : 50;

                tableBody.push([
                    { content: \`\${step.numero_paso}. \${stepAction}\`, styles: { minCellHeight: minHeight } },
                    { content: loadedImages.length === 0 ? this.EVIDENCE_PLACEHOLDER : '', styles: { minCellHeight: minHeight } }
                ]);

                imagesToDraw.push({ rowIndex: rowCounter, images: loadedImages });
                rowCounter++;
            }
            
            if(tableBody.length > 0) {
                autoTable(doc, {
                    startY: margin + 30,
                    head: [['Paso a paso', 'Evidencias']],
                    body: tableBody,
                    theme: 'grid',
                    headStyles: { fillColor: [46, 116, 181], textColor: 255 },
                    columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 'auto' } },
                    didDrawCell: (data) => {
                        if (data.section === 'body' && data.column.index === 1) {
                            const rowInfo = imagesToDraw.find(img => img.rowIndex === data.row.index);
                            if (rowInfo && rowInfo.images.length > 0) {
                                const pad = 10;
                                const imgW = data.cell.width - (pad * 2);
                                const imgH = data.cell.height - (pad * 2);
                                // For simplicity, draw the first image centered and fit
                                // If multiple images, they should be arranged, but we simplify to 1 main image for analysis
                                const ev = rowInfo.images[0];
                                const format = ev.type.toUpperCase() || 'PNG';
                                const x = data.cell.x + pad;
                                const y = data.cell.y + pad;
                                doc.addImage(ev.base64Data, format, x, y, imgW, imgH);
                            }
                        }
                    }
                });
            }

            onProgress?.(i + 1, reports.length);
        }

        const filename = this.escapeFilename(\`Reporte_Evidencias_HU_\${huNumber}.pdf\`);
        doc.save(filename);
    }
`;

code = code.replace(/}\s*$/, pdfMethods + '\n}');

fs.writeFileSync(path, code, 'utf8');
console.log("Patched export.service.ts with PDF methods");
