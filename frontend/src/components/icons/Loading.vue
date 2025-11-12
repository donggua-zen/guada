<!-- components/LoadingIcon.vue -->
<template>
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="0" fill="currentColor">
            <animate id="SVGPW9ARccz" fill="freeze" attributeName="r" begin="0;SVGaeu34cWL.end" calcMode="spline"
                dur="1.2s" keySplines=".52,.6,.25,.99" values="0;11" />
            <animate fill="freeze" attributeName="opacity" begin="0;SVGaeu34cWL.end" calcMode="spline" dur="1.2s"
                keySplines=".52,.6,.25,.99" values="1;0" />
        </circle>
        <circle cx="12" cy="12" r="0" fill="currentColor">
            <animate id="SVGODvPjeTJ" fill="freeze" attributeName="r" begin="SVGPW9ARccz.begin+0.2s" calcMode="spline"
                dur="1.2s" keySplines=".52,.6,.25,.99" values="0;11" />
            <animate fill="freeze" attributeName="opacity" begin="SVGPW9ARccz.begin+0.2s" calcMode="spline" dur="1.2s"
                keySplines=".52,.6,.25,.99" values="1;0" />
        </circle>
        <circle cx="12" cy="12" r="0" fill="currentColor">
            <animate id="SVGaeu34cWL" fill="freeze" attributeName="r" begin="SVGPW9ARccz.begin+0.4s" calcMode="spline"
                dur="1.2s" keySplines=".52,.6,.25,.99" values="0;11" />
            <animate fill="freeze" attributeName="opacity" begin="SVGPW9ARccz.begin+0.4s" calcMode="spline" dur="1.2s"
                keySplines=".52,.6,.25,.99" values="1;0" />
        </circle>
    </svg>
</template>

<script setup>
// defineProps({
//     colorClass: {
//         type: String,
//         default: 'text-blue-500'
//     }
// })
</script>