(function(){"use strict";if(window.__dewsecureInjected)return;window.__dewsecureInjected=!0;function r(){let e=document.createElement("script");e.textContent=d(),e.setAttribute("data-dewsecure","anti-bypass");let t=document.head||document.documentElement;t.insertBefore(e,t.firstChild),e.remove()}function d(){let t=`_0x${(Date.now()&4294967295).toString(16)}`;return`
(function() {
    'use strict';
    const ${t} = {
        adBlock: false,
        adblock: false,
        adsBlocked: 0,
        isAdBlockActive: false,
        canRunAds: true,
        canShowAds: true,
        adblockDetected: false,
    };
    const props = ['adBlock', 'adblock', 'adsBlocked', 'isAdBlockActive',
                   'canRunAds', 'canShowAds', 'adblockDetected'];
    for (const p of props) {
        try {
            Object.defineProperty(window, p, {
                get: () => ${t}[p],
                configurable: true,
            });
        } catch(e) {}
    }
})();
`}let i=['[class*="ad-"]','[class*="ads-"]','[class*="advert"]','[id*="ad-"]','[id*="ads-"]','[id*="advert"]','[class*="banner"]','[class*="popup"]','[class*="sponsor"]','iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]','iframe[src*="ads"]',"[data-ad]","[data-ads]","[data-ad-slot]"];function o(){for(let e of i)try{let t=document.querySelectorAll(e);for(let n of t){let c=n.getBoundingClientRect();c.width<10||c.height<10||n.querySelector('article, main, [role="main"]')||(n.style.setProperty("display","none","important"),n.style.setProperty("visibility","hidden","important"),n.style.setProperty("opacity","0","important"))}}catch{}}let s=null;function a(){s||(s=setTimeout(()=>{o(),s=null},100))}let l=new MutationObserver(e=>{for(let t of e)if(t.addedNodes.length>0){a();break}});function u(){r(),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",o):o(),l.observe(document.documentElement,{childList:!0,subtree:!0})}u(),chrome.runtime.onMessage.addListener((e,t,n)=>(e.type==="HIDE_ELEMENTS"&&(o(),n({ok:!0})),!0)),console.log("DewSecure Content Script \u5DF2\u52A0\u8F7D")})();
