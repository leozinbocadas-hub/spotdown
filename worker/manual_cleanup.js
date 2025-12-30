require('dotenv').config();
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function deleteAllInFolder(prefix) {
    console.log(`[CLEANUP] Iniciando limpeza total do prefixo: ${prefix}`);
    try {
        let isTruncated = true;
        let cursor = undefined;

        while (isTruncated) {
            const listParams = {
                Bucket: process.env.R2_BUCKET_NAME,
                Prefix: prefix,
                ContinuationToken: cursor
            };

            const listedObjects = await r2.send(new ListObjectsV2Command(listParams));

            if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
                console.log(`[CLEANUP] Nenhum arquivo encontrado com o prefixo ${prefix}`);
                break;
            }

            const deleteParams = {
                Bucket: process.env.R2_BUCKET_NAME,
                Delete: { Objects: [] }
            };

            listedObjects.Contents.forEach(({ Key }) => {
                deleteParams.Delete.Objects.push({ Key });
                console.log(`[CLEANUP] Agendado para deletar: ${Key}`);
            });

            const deleteResult = await r2.send(new DeleteObjectsCommand(deleteParams));
            console.log(`[CLEANUP] Deletados ${deleteResult.Deleted?.length || 0} arquivos.`);

            isTruncated = listedObjects.IsTruncated;
            cursor = listedObjects.NextContinuationToken;
        }

        console.log(`[CLEANUP] Limpeza de "${prefix}" concluída com sucesso.`);
    } catch (e) {
        console.error(`[CLEANUP ERROR] Falha ao limpar prefixo ${prefix}:`, e.message);
    }
}

// Executar limpeza da pasta tracks e também de arquivos zip soltos
(async () => {
    console.log('--- INICIANDO FAXINA MANUAL NO R2 ---');

    // 1. Limpar pasta tracks/
    await deleteAllInFolder('tracks/');

    // 2. Opcional: Limpar arquivos .zip que ficaram órfãos no root
    // Para simplificar, vamos focar no que você pediu (tracks)

    console.log('--- FAXINA FINALIZADA ---');
    process.exit(0);
})();
